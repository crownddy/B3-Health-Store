import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

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
    (product) => Number(product.quantity) > 0 && Number(product.quantity) <= Number(product.minimum_stock)
  );
  const outOfStock = products.filter((product) => Number(product.quantity) <= 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 30 * 86_400_000);

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
    lowStockProducts: lowStock.slice(0, 5),
    expiringBatches: expiring.slice(0, 5)
  };
}

export async function getProducts(): Promise<ProductRow[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id,name,category,sku,selling_price,purchase_price,quantity,minimum_stock,shelf_number,is_visible_on_homepage,is_featured,created_at"
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Unable to load products: ${error.message}`);
  return (data ?? []) as ProductRow[];
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

export async function getBatches(): Promise<ExpiringRow[]> {
  if (!isSupabaseConfigured) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_batches")
    .select("id,batch_number,expiration_date,quantity_remaining,products(name)")
    .order("expiration_date", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`Unable to load batches: ${error.message}`);
  return (data ?? []) as ExpiringRow[];
}
