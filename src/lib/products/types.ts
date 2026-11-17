export type ProductStatus = "active" | "archived";

export type ProductRecord = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  sku: string | null;
  barcode: string | null;
  image_url: string | null;
  purchase_price: number;
  selling_price: number;
  quantity: number;
  minimum_stock: number;
  shelf_number: string | null;
  status: ProductStatus;
  is_visible_on_homepage: boolean;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * The fields a product form may write.
 *
 * `quantity` is deliberately absent. Stock levels are only ever changed by the
 * inventory/stock-movement workflow, so ordinary product editing can never
 * silently overwrite stock or the movement history behind it.
 */
export type ProductInput = {
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  description: string | null;
  purchase_price: number;
  selling_price: number;
  minimum_stock: number;
  shelf_number: string | null;
  image_url: string | null;
  is_visible_on_homepage: boolean;
  is_featured: boolean;
};

export type ProductBatchSummary = {
  id: string;
  batch_number: string | null;
  production_date: string | null;
  expiration_date: string | null;
  quantity_received: number;
  quantity_remaining: number;
  created_at: string;
};

/**
 * Optional opening stock captured on the Add Product form.
 *
 * Absent (or a zero quantity) means the product is created with no batch at
 * all; the initial stock is only turned into a batch when a quantity is given.
 */
export type InitialStockInput = {
  quantity: number;
  expiration_date: string | null;
  batch_number: string | null;
};

export type CatalogQuery = {
  search?: string;
  category?: string;
  status?: ProductStatus | "all";
};
