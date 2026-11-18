/**
 * Page arithmetic shared by the paged admin lists (Sold, Inventory).
 *
 * Pure and dependency-free so the client controls, the server page and the
 * unit tests all agree on how many pages exist and which page is in range.
 */

/** Total number of pages for a result count; at least 1 so the pager is stable. */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Keeps a page number within range for the given total. */
export function clampPage(page: number, total: number, pageSize: number): number {
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.trunc(page)), pageCount(total, pageSize) - 1);
}
