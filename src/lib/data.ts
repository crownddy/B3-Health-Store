import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ProductBatchSummary, ProductRecord } from "@/lib/products/types";
import type { InventoryPagePayload } from "@/lib/products/inventory";
import { EXPIRING_SOON_DAYS } from "@/lib/products/batches";

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
  if (error) throw new Error(`Unable to load dashboard data: ${error.message}`);

  const payload = (data ?? {}) as Partial<DashboardMetrics>;
  return { ...EMPTY_METRICS, ...payload };
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
  if (error) throw new Error(`Unable to load inventory: ${error.message}`);
  return (data ?? {}) as InventoryPagePayload;
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
  if (error) throw new Error(`Unable to load batches: ${error.message}`);
  const payload = (data ?? {}) as InventoryBatchPayload;
  return {
    items: payload.items ?? [],
    total: Number(payload.total ?? 0),
    expired: Number(payload.expired ?? 0),
    expiringSoon: Number(payload.expiring_soon ?? 0)
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
