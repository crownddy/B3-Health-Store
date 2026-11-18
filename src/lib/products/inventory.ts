/**
 * Shapes and mapping for the Inventory product list.
 *
 * The primary path does search, expiration filtering and pagination in the
 * database (see `list_inventory_products` in
 * supabase/migrations/20261119_inventory_query_pushdown.sql), so only the
 * requested page of products crosses the wire. This module holds the pure
 * mapping from that payload to what the list renders.
 *
 * It also holds the application-side equivalent, used as a fallback when the
 * database function is not deployed yet (see `src/lib/supabase/rpc.ts`). Both
 * paths produce the same `InventoryPage`, so the list renders identically and
 * the fallback can be unit tested without a database. Nothing here touches
 * stock or batch records.
 */
import {
  productExpiryStatus,
  type ExpiryStatus,
  type ExpirySummaryBatch
} from "./batches.ts";
import { clampPage, pageCount } from "./pagination.ts";

/** Products shown per page on the Inventory list. */
export const INVENTORY_PAGE_SIZE = 10;

/** A product row as returned by `list_inventory_products`. */
export type InventoryListItem = {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
  quantity: number;
  minimum_stock: number;
  status: string;
  /** How many batches the product has, including emptied ones (history). */
  batch_count: number;
  /** The most urgent expiration status across the product's in-stock batches. */
  expiry_status: string;
};

/** A product row as the list renders it. */
export type InventoryRow = {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
  quantity: number;
  minimum_stock: number;
  status: string;
  batchCount: number;
  expiryStatus: ExpiryStatus;
};

/** One page of the Inventory list, with the counts the pager needs. */
export type InventoryPage = {
  items: InventoryRow[];
  total: number;
  page: number;
  pages: number;
};

/** The raw payload `list_inventory_products` returns. */
export type InventoryPagePayload = {
  items?: InventoryListItem[];
  total?: number;
  page?: number;
  pages?: number;
};

/** The product fields the application-side fallback needs. */
export type InventoryProduct = {
  id: string;
  name: string;
  category: string | null;
  image_url: string | null;
  quantity: number;
  minimum_stock: number;
  status: string;
};

/** A batch joined to its product, as loaded for the application-side fallback. */
export type InventoryBatch = ExpirySummaryBatch & {
  product_id: string;
};

const EXPIRY_STATUSES: readonly ExpiryStatus[] = [
  "expired",
  "expiring_soon",
  "valid",
  "no_date"
];

export function isExpiryStatus(value: unknown): value is ExpiryStatus {
  return typeof value === "string" && (EXPIRY_STATUSES as readonly string[]).includes(value);
}

/** Maps the RPC's snake_case rows to the list's camelCase shape. */
export function mapInventoryItems(items: InventoryListItem[]): InventoryRow[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    image_url: item.image_url,
    quantity: item.quantity,
    minimum_stock: item.minimum_stock,
    status: item.status,
    batchCount: item.batch_count,
    expiryStatus: isExpiryStatus(item.expiry_status) ? item.expiry_status : "no_date"
  }));
}

/**
 * Normalises the RPC payload into a page.
 *
 * The database already clamps the page and computes the totals; this only
 * guards against a missing or malformed payload so the list never renders a
 * page past the end, and keeps the total/pages consistent with the item count
 * if the payload is incomplete.
 */
export function toInventoryPage(
  payload: InventoryPagePayload | null | undefined
): InventoryPage {
  const rawItems = Array.isArray(payload?.items) ? payload.items : [];
  const items = mapInventoryItems(rawItems);

  const total = Number.isFinite(payload?.total) ? Number(payload?.total) : items.length;
  const pages = Number.isFinite(payload?.pages) ? Math.max(1, Number(payload?.pages)) : 1;
  const requested = Number.isFinite(payload?.page) ? Math.trunc(Number(payload?.page)) : 0;
  const page = Math.min(Math.max(0, requested), pages - 1);

  return { items, total, page, pages };
}

// --- Application-side fallback -------------------------------------------
//
// Used only when the database functions are not deployed yet. These reproduce
// the exact rules the RPCs apply, so the list is correct either way; they are
// pure so they can be unit tested without a database.

/** Groups batches by product id, so each product can be summarised once. */
export function groupBatchesByProduct(
  batches: InventoryBatch[]
): Map<string, ExpirySummaryBatch[]> {
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
 * page and the expiry screens use, and the same one the RPC computes.
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

/** Case-insensitive search on the product name, matching the RPC's ILIKE. */
export function searchInventory<T extends { name: string }>(rows: T[], term: string): T[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.name.toLowerCase().includes(needle));
}

/** Keeps only the products whose aggregate expiration status matches. */
export function filterByExpiryStatus(
  rows: InventoryRow[],
  status: ExpiryStatus | "all"
): InventoryRow[] {
  if (status === "all") return rows;
  return rows.filter((row) => row.expiryStatus === status);
}

/** Slices a filtered list to one page, clamping the requested page into range. */
export function paginateInventory(
  rows: InventoryRow[],
  requestedPage: number,
  pageSize: number = INVENTORY_PAGE_SIZE
): InventoryPage {
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
