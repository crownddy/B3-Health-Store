/**
 * Shapes and mapping for the Inventory product list.
 *
 * Search, expiration filtering and pagination are done by the database (see
 * `list_inventory_products` in
 * supabase/migrations/20261119_inventory_query_pushdown.sql), so only the
 * requested page of products crosses the wire. This module holds the pure
 * mapping from that payload to what the list renders, so it can be unit tested
 * without a database. Nothing here touches stock or batch records.
 */
import type { ExpiryStatus } from "./batches.ts";

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
