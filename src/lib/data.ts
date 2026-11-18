import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRpcFunction, warnMissingRpcFunction } from "@/lib/supabase/rpc";
import type { ProductBatchSummary, ProductRecord } from "@/lib/products/types";
import {
  buildInventoryRows,
  filterByExpiryStatus,
  paginateInventory,
  searchInventory,
  toInventoryPage,
  type InventoryBatch,
  type InventoryPagePayload,
  type InventoryProduct
} from "@/lib/products/inventory";
import { EXPIRING_SOON_DAYS, classifyExpiry, filterBatchesByExpiry, type ExpiryStatus } from "@/lib/products/batches";

/** Columns loaded for the admin catalogue. */
const PRODUCT_COLUMNS =
  "id,name,description,category,sku,barcode,image_url,purchase_price,selling_price,quantity,minimum_stock,shelf_number,status,is_visible_on_homepage,is_featured,created_at,updated_at";


export type DashboardMetrics = {
  totalProducts: number;
  visibleProducts: number;
  totalCategories: number;
  totalStaff: number;
  inventoryValue: number;
  stockUnits: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number;
  expiredCount: number;
  recentMovements: MovementRow[];
  lowStockProducts: LowStockRow[];
  expiringBatches: ExpiringRow[];
};

export type MovementRow = {
  id: string;
  movement_type: string;
  quantity: number;
  note: string | null;
  created_at: string;
  products: { name: string } | { name: string }[] | null;
};

export type LowStockRow = {
  id: string;
  name: string;
  quantity: number;
  minimum_stock: number;
  shelf_number: string | null;
};

export type ExpiringRow = {
  id: string;
  batch_number: string | null;
  expiration_date: string | null;
  quantity_remaining: number;
  products: { name: string } | { name: string }[] | null;
};

/** A batch joined to its product, as loaded for the inventory/expiry screens. */
export type BatchWithProduct = {
  id: string;
  product_id: string;
  batch_number: string | null;
  production_date: string | null;
  expiration_date: string | null;
  quantity_received: number;
  quantity_remaining: number;
  created_at: string;
  products: { name: string } | { name: string }[] | null;
};

/** A product row as loaded for the dashboard fallback computation. */
export type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  sku: string | null;
  selling_price: number;
  purchase_price: number;
  quantity: number;
  minimum_stock: number;
  shelf_number: string | null;
  is_visible_on_homepage: boolean;
  is_featured: boolean;
  created_at: string;
};

export type StaffRow = {
  id: string;
  full_name: string | null;
  role: string;
  created_at: string;
};


export { relationName } from "@/lib/format";

const EMPTY_METRICS: DashboardMetrics = {
  totalProducts: 0,
  visibleProducts: 0,
  totalCategories: 0,
  totalStaff: 0,
  inventoryValue: 0,
  stockUnits: 0,
  lowStockCount: 0,
  outOfStockCount: 0,
  expiringSoonCount: 0,
  expiredCount: 0,
  recentMovements: [],
  lowStockProducts: [],
  expiringBatches: []
};

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  if (!isSupabaseConfigured) return EMPTY_METRICS;

  const supabase = await createClient();
  // The figures are computed in the database, so the dashboard no longer loads
  // the whole catalogue and every dated batch to derive them.
  const { data, error } = await supabase.rpc("dashboard_metrics", {
    p_soon_days: EXPIRING_SOON_DAYS
  });

  // A deployment can reach production before an operator has applied the
  // migration that adds this function (e.g. a preview against the existing
  // project). Fall back to the original application-side computation rather
  // than crashing the page; any other error still surfaces.
  if (error) {
    if (isMissingRpcFunction(error)) {
      warnMissingRpcFunction("dashboard_metrics", "20261119_inventory_query_pushdown.sql");
      return getDashboardMetricsFallback(supabase);
    }
    throw new Error(`Unable to load dashboard data: ${error.message}`);
  }

  const payload = (data ?? {}) as Partial<DashboardMetrics>;
  return { ...EMPTY_METRICS, ...payload };
}

/**
 * The original dashboard computation, kept as the fallback for a database
 * without `dashboard_metrics`. Reads the same rows under Row Level Security and
 * derives the same figures, so the overview is correct either way — it is just
 * not pushed down into the database.
 */
async function getDashboardMetricsFallback(
  supabase: SupabaseClient
): Promise<DashboardMetrics> {
  const [productsRes, categoriesRes, staffRes, movementsRes, batchesRes] = await Promise.all([
    supabase
      .from("products")
      .select(
        "id,name,category,sku,selling_price,purchase_price,quantity,minimum_stock,shelf_number,is_visible_on_homepage,is_featured,created_at"
      ),
    supabase.from("categories").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase
      .from("stock_movements")
      .select("id,movement_type,quantity,note,created_at,products(name)")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("product_batches")
      .select("id,batch_number,expiration_date,quantity_remaining,products(name)")
      .not("expiration_date", "is", null)
      .order("expiration_date", { ascending: true })
  ]);

  const firstError =
    productsRes.error || categoriesRes.error || staffRes.error || movementsRes.error || batchesRes.error;
  if (firstError) {
    throw new Error(`Unable to load dashboard data: ${firstError.message}`);
  }

  const products = (productsRes.data ?? []) as ProductRow[];
  const batches = (batchesRes.data ?? []) as ExpiringRow[];

  const inventoryValue = products.reduce(
    (sum, product) => sum + Number(product.selling_price ?? 0) * Number(product.quantity ?? 0),
    0
  );
  const stockUnits = products.reduce((sum, product) => sum + Number(product.quantity ?? 0), 0);

  const lowStock = products.filter(
    (product) =>
      Number(product.quantity) > 0 && Number(product.quantity) <= Number(product.minimum_stock)
  );
  const outOfStock = products.filter((product) => Number(product.quantity) <= 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + EXPIRING_SOON_DAYS * 86_400_000);

  const expiring = batches.filter((batch) => {
    if (!batch.expiration_date) return false;
    const date = new Date(batch.expiration_date);
    if (Number.isNaN(date.getTime())) return false;
    return date >= today && date <= horizon;
  });
  const expired = batches.filter((batch) => {
    if (!batch.expiration_date) return false;
    const date = new Date(batch.expiration_date);
    if (Number.isNaN(date.getTime())) return false;
    return date < today;
  });

  return {
    totalProducts: products.length,
    visibleProducts: products.filter((product) => product.is_visible_on_homepage).length,
    totalCategories: categoriesRes.count ?? 0,
    totalStaff: staffRes.count ?? 0,
    inventoryValue,
    stockUnits,
    lowStockCount: lowStock.length,
    outOfStockCount: outOfStock.length,
    expiringSoonCount: expiring.length,
    expiredCount: expired.length,
    recentMovements: (movementsRes.data ?? []) as MovementRow[],
    lowStockProducts: lowStock.slice(0, 5) as LowStockRow[],
    expiringBatches: expiring.slice(0, 5) as ExpiringRow[]
  };
}

/**
 * One page of the Inventory product list.
 *
 * Search, expiration filtering and pagination all run in PostgreSQL
 * (`list_inventory_products`), so only the requested page of products — and only
 * their batch count and aggregate expiration status — crosses the wire. The
 * payload carries the exact total, so the pager stays correct while filtering.
 * Row Level Security still decides what the caller can read.
 */
export async function getInventoryProducts(
  search: string,
  expiry: string,
  page: number,
  pageSize: number
): Promise<InventoryPagePayload> {
  if (!isSupabaseConfigured) return { items: [], total: 0, page: 0, pages: 1 };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_inventory_products", {
    p_search: search || null,
    p_expiry: expiry === "all" ? null : expiry,
    p_page: Math.max(0, page),
    p_page_size: pageSize,
    p_soon_days: EXPIRING_SOON_DAYS
  });

  if (error) {
    if (isMissingRpcFunction(error)) {
      warnMissingRpcFunction("list_inventory_products", "20261119_inventory_query_pushdown.sql");
      return getInventoryProductsFallback(supabase, search, expiry, page, pageSize);
    }
    throw new Error(`Unable to load inventory: ${error.message}`);
  }
  return (data ?? {}) as InventoryPagePayload;
}

/**
 * The original application-side inventory query, kept as the fallback for a
 * database without `list_inventory_products`. It loads the products and batches
 * under Row Level Security and applies the same search, expiry filter and paging
 * the RPC does, so the list is correct — just not pushed down.
 */
async function getInventoryProductsFallback(
  supabase: SupabaseClient,
  search: string,
  expiry: string,
  page: number,
  pageSize: number
): Promise<InventoryPagePayload> {
  const [productsRes, batchesRes] = await Promise.all([
    supabase
      .from("products")
      .select("id,name,category,image_url,quantity,minimum_stock,status")
      .order("created_at", { ascending: false }),
    supabase.from("product_batches").select("product_id,expiration_date,quantity_remaining")
  ]);

  const firstError = productsRes.error || batchesRes.error;
  if (firstError) {
    throw new Error(`Unable to load inventory: ${firstError.message}`);
  }

  const rows = buildInventoryRows(
    (productsRes.data ?? []) as InventoryProduct[],
    (batchesRes.data ?? []) as InventoryBatch[]
  );
  const filtered = filterByExpiryStatus(searchInventory(rows, search), expiry as ExpiryStatus | "all");
  const result = paginateInventory(filtered, page, pageSize);

  // Map back to the RPC's snake_case shape so the page maps it the same way
  // whichever path produced it.
  return {
    items: result.items.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      image_url: row.image_url,
      quantity: row.quantity,
      minimum_stock: row.minimum_stock,
      status: row.status,
      batch_count: row.batchCount,
      expiry_status: row.expiryStatus
    })),
    total: result.total,
    page: result.page,
    pages: result.pages
  };
}

/** A batch row for the Inventory "Batches & expiry" section. */
export type InventoryBatchRow = {
  id: string;
  batch_number: string | null;
  expiration_date: string | null;
  quantity_remaining: number;
  product_name: string | null;
};

export type InventoryBatchPage = {
  items: InventoryBatchRow[];
  total: number;
  expired: number;
  expiringSoon: number;
};

/** The raw payload `list_inventory_batches` returns. */
export type InventoryBatchPayload = {
  items?: InventoryBatchRow[];
  total?: number;
  expired?: number;
  expiring_soon?: number;
};

/**
 * A bounded page of batches for the Inventory screen, most urgent expiry first,
 * with the exact expired / expiring-soon counts. Only the requested slice is
 * loaded, so a large batch history never has to be shipped to render a few rows.
 */
export async function getInventoryBatches(
  expiry: string,
  limit = 50
): Promise<InventoryBatchPage> {
  if (!isSupabaseConfigured) return { items: [], total: 0, expired: 0, expiringSoon: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_inventory_batches", {
    p_expiry: expiry === "all" ? null : expiry,
    p_limit: limit,
    p_offset: 0,
    p_soon_days: EXPIRING_SOON_DAYS
  });

  if (error) {
    if (isMissingRpcFunction(error)) {
      warnMissingRpcFunction("list_inventory_batches", "20261119_inventory_query_pushdown.sql");
      return getInventoryBatchesFallback(supabase, expiry, limit);
    }
    throw new Error(`Unable to load batches: ${error.message}`);
  }

  const payload = (data ?? {}) as InventoryBatchPayload;
  return {
    items: payload.items ?? [],
    total: Number(payload.total ?? 0),
    expired: Number(payload.expired ?? 0),
    expiringSoon: Number(payload.expiring_soon ?? 0)
  };
}

type BatchRowWithProduct = InventoryBatchRow & { product_id: string };

/**
 * The original application-side batch query, kept as the fallback for a
 * database without `list_inventory_batches`. It classifies each batch with the
 * same rule as the RPC (against the start of today), returns the most urgent
 * slice and the exact whole-table expired / expiring-soon counts.
 */
async function getInventoryBatchesFallback(
  supabase: SupabaseClient,
  expiry: string,
  limit: number
): Promise<InventoryBatchPage> {
  const { data, error } = await supabase
    .from("product_batches")
    .select("id,batch_number,expiration_date,quantity_remaining,product_id,products(name)");
  if (error) throw new Error(`Unable to load batches: ${error.message}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rows: BatchRowWithProduct[] = (data ?? []).map((row) => {
    const record = row as unknown as {
      id: string;
      batch_number: string | null;
      expiration_date: string | null;
      quantity_remaining: number;
      product_id: string;
      products: { name: string } | { name: string }[] | null;
    };
    const product = Array.isArray(record.products) ? record.products[0] : record.products;
    return {
      id: record.id,
      batch_number: record.batch_number,
      expiration_date: record.expiration_date,
      quantity_remaining: record.quantity_remaining,
      product_name: product?.name ?? null,
      product_id: record.product_id
    };
  });

  // Counts are over the whole table, independent of the requested filter slice.
  const expired = rows.filter((row) => classifyExpiry(row.expiration_date, today) === "expired").length;
  const expiringSoon = rows.filter(
    (row) => classifyExpiry(row.expiration_date, today) === "expiring_soon"
  ).length;

  const filtered = filterBatchesByExpiry(rows, expiry as ExpiryStatus | "all", today);
  const ordered = [...filtered].sort((a, b) => {
    if (a.expiration_date === b.expiration_date) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    if (a.expiration_date === null) return 1;
    if (b.expiration_date === null) return -1;
    return a.expiration_date < b.expiration_date ? -1 : 1;
  });

  return {
    items: ordered.slice(0, Math.max(limit, 0)).map((row) => ({
      id: row.id,
      batch_number: row.batch_number,
      expiration_date: row.expiration_date,
      quantity_remaining: row.quantity_remaining,
      product_name: row.product_name
    })),
    total: filtered.length,
    expired,
    expiringSoon
  };
}

export async function getProducts(): Promise<ProductRecord[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Unable to load products: ${error.message}`);
  return (data ?? []) as unknown as ProductRecord[];
}

export async function getProduct(id: string): Promise<ProductRecord | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Unable to load product: ${error.message}`);
  return (data as unknown as ProductRecord) ?? null;
}

export async function getProductBatches(productId: string): Promise<ProductBatchSummary[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_batches")
    .select(
      "id,batch_number,production_date,expiration_date,quantity_received,quantity_remaining,created_at"
    )
    .eq("product_id", productId)
    .order("expiration_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Unable to load batches: ${error.message}`);
  return (data ?? []) as ProductBatchSummary[];
}

/** Counts of the historical records that block a permanent delete. */
export async function getProductReferenceCounts(
  productId: string
): Promise<{ stockMovements: number; batches: number }> {
  if (!isSupabaseConfigured) return { stockMovements: 0, batches: 0 };
  const supabase = await createClient();
  const [movements, batches] = await Promise.all([
    supabase
      .from("stock_movements")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId),
    supabase
      .from("product_batches")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
  ]);
  if (movements.error) throw new Error(`Unable to check movements: ${movements.error.message}`);
  if (batches.error) throw new Error(`Unable to check batches: ${batches.error.message}`);
  return { stockMovements: movements.count ?? 0, batches: batches.count ?? 0 };
}

/**
 * Reference counts for several products at once, for the Inventory list.
 *
 * Only the ids on the current page are requested, so the check never loads the
 * whole catalogue. Row Level Security still decides what the caller can count.
 */
export async function getProductReferenceCountsMany(
  productIds: string[]
): Promise<Map<string, { stockMovements: number; batches: number }>> {
  const result = new Map<string, { stockMovements: number; batches: number }>();
  if (!isSupabaseConfigured || productIds.length === 0) return result;

  const supabase = await createClient();
  const [movements, batches] = await Promise.all([
    supabase.from("stock_movements").select("product_id").in("product_id", productIds),
    supabase.from("product_batches").select("product_id").in("product_id", productIds)
  ]);
  if (movements.error) throw new Error(`Unable to check movements: ${movements.error.message}`);
  if (batches.error) throw new Error(`Unable to check batches: ${batches.error.message}`);

  for (const id of productIds) result.set(id, { stockMovements: 0, batches: 0 });
  for (const row of (movements.data ?? []) as { product_id: string }[]) {
    const entry = result.get(row.product_id);
    if (entry) entry.stockMovements += 1;
  }
  for (const row of (batches.data ?? []) as { product_id: string }[]) {
    const entry = result.get(row.product_id);
    if (entry) entry.batches += 1;
  }
  return result;
}

/** Stock movement history for one product, newest first. */
export async function getProductMovements(
  productId: string,
  limit = 50
): Promise<MovementRow[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id,movement_type,quantity,note,created_at,products(name)")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Unable to load stock movements: ${error.message}`);
  return (data ?? []) as MovementRow[];
}


export type SellableProductRow = {
  id: string;
  name: string;
  quantity: number;
};

export type SellablePage = {
  items: SellableProductRow[];
  total: number;
};

/**
 * A page of products that can be sold right now (active, with sellable stock).
 *
 * The sellable figure and the filtering/paging are computed by the
 * `list_sellable_products` function so the Sold screen and the stock-out
 * deduction use one definition. Row Level Security still governs what the
 * caller can read.
 */
export async function getSellableProducts(
  search: string,
  page: number,
  pageSize: number
): Promise<SellablePage> {
  if (!isSupabaseConfigured) return { items: [], total: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_sellable_products", {
    p_search: search || null,
    p_limit: pageSize,
    p_offset: Math.max(0, page) * pageSize
  });
  if (error) throw new Error(`Unable to load sellable products: ${error.message}`);
  const payload = (data ?? {}) as { items?: SellableProductRow[]; total?: number };
  return { items: payload.items ?? [], total: Number(payload.total ?? 0) };
}

export async function getCategories(): Promise<{ id: string; name: string }[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("categories").select("id,name").order("name");
  if (error) throw new Error(`Unable to load categories: ${error.message}`);
  return (data ?? []) as { id: string; name: string }[];
}

export async function getStaff(): Promise<StaffRow[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id,full_name,role,created_at")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Unable to load staff: ${error.message}`);
  return (data ?? []) as StaffRow[];
}

export async function getStockMovements(limit = 50): Promise<MovementRow[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_movements")
    .select("id,movement_type,quantity,note,created_at,products(name)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Unable to load stock movements: ${error.message}`);
  return (data ?? []) as MovementRow[];
}

export async function getBatches(): Promise<BatchWithProduct[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_batches")
    .select(
      "id,product_id,batch_number,production_date,expiration_date,quantity_received,quantity_remaining,created_at,products(name)"
    )
    .order("expiration_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Unable to load batches: ${error.message}`);
  return (data ?? []) as unknown as BatchWithProduct[];
}
