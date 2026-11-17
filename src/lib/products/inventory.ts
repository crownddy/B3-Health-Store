/**
 * Pure helpers for the Inventory list.
 *
 * Search, per-product expiration status and pagination are computed here so
 * they can be unit tested without a database, and so the server page and the
 * client controls apply exactly the same rules. Nothing here touches stock or
 * batch records — it only reads what the caller already loaded (under RLS).
 */
import {
  productExpiryStatus,
  type ExpiryStatus,
  type ExpirySummaryBatch
} from "./batches.ts";
import { clampPage, pageCount } from "./pagination.ts";

/** Products shown per page on the Inventory list. */
export const INVENTORY_PAGE_SIZE = 10;

/** The product fields the Inventory list needs. */
export type InventoryProduct = {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
  quantity: number;
  minimum_stock: number;
  status: string;
};

/** A batch joined to its product, as loaded for the Inventory list. */
export type InventoryBatch = ExpirySummaryBatch & {
  product_id: string;
};

/** A product with its batch-derived expiration status for the list. */
export type InventoryRow = InventoryProduct & {
  batchCount: number;
  expiryStatus: ExpiryStatus;
};

/** Groups batches by product id, so each product can be summarised once. */
export function groupBatchesByProduct(batches: InventoryBatch[]): Map<string, ExpirySummaryBatch[]> {
  const grouped = new Map<string, ExpirySummaryBatch[]>();
  for (const batch of batches) {
    const list = grouped.get(batch.product_id);
    if (list) list.push(batch);
    else grouped.set(batch.product_id, [batch]);
  }
  return grouped;
}

/**
 * Attaches a batch count and an aggregate expiration status to every product.
 *
 * The status is derived from the product's in-stock batches (see
 * `productExpiryStatus`), so the list shows the same classification the detail
 * page and the expiry screens use.
 */
export function buildInventoryRows(
  products: InventoryProduct[],
  batches: InventoryBatch[],
  today: Date = new Date()
): InventoryRow[] {
  const grouped = groupBatchesByProduct(batches);
  return products.map((product) => {
    const own = grouped.get(product.id) ?? [];
    return {
      ...product,
      batchCount: own.length,
      expiryStatus: productExpiryStatus(own, today)
    };
  });
}

/** Case-insensitive search on the product name. */
export function searchInventory<T extends { name: string }>(rows: T[], term: string): T[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

/** Keeps only the products whose aggregate expiration status matches. */
export function filterByExpiryStatus<T extends { expiryStatus: ExpiryStatus }>(
  rows: T[],
  status: ExpiryStatus | "all"
): T[] {
  if (status === "all") return rows;
  return rows.filter((row) => row.expiryStatus === status);
}

export type InventoryPage<T> = {
  items: T[];
  total: number;
  page: number;
  pages: number;
};

/** Slices a filtered list to one page, clamping the requested page into range. */
export function paginateInventory<T>(
  rows: T[],
  requestedPage: number,
  pageSize: number = INVENTORY_PAGE_SIZE
): InventoryPage<T> {
  const total = rows.length;
  const page = clampPage(requestedPage, total, pageSize);
  const start = page * pageSize;
  return {
    items: rows.slice(start, start + pageSize),
    total,
    page,
    pages: pageCount(total, pageSize)
  };
}
