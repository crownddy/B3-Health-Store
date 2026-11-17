/**
 * Pure helpers for the Sold screen.
 *
 * Quantity validation and pagination maths live here so they are unit-testable
 * without a browser or a database, and so the client and the server action
 * apply exactly the same rules. Recording the sale itself is done by the
 * existing record_stock_movement function (see
 * supabase/migrations/20261117b_atomic_inventory_operations.sql); nothing here
 * touches stock.
 */

/** Products shown per page on the Sold screen. */
export const SALE_PAGE_SIZE = 8;

export type SellableProduct = {
  id: string;
  name: string;
  /** Units that can be sold right now: unexpired batches plus any unbatched stock. */
  quantity: number;
};

export type SaleValidation = { ok: true; value: number } | { ok: false; message: string };

/**
 * Validates the quantity to sell.
 *
 * A sale must be a whole number greater than zero and can never exceed the
 * available quantity. The database enforces the same upper bound, so this is
 * the friendly first line of defence, not the only one.
 */
export function validateSaleQuantity(raw: string, available: number): SaleValidation {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, message: "Enter the quantity sold." };

  const value = Number(trimmed);
  if (!Number.isInteger(value)) {
    return { ok: false, message: "Quantity sold must be a whole number." };
  }
  if (value <= 0) {
    return { ok: false, message: "Quantity sold must be greater than zero." };
  }
  if (value > available) {
    return {
      ok: false,
      message: `Only ${available} unit${available === 1 ? "" : "s"} in stock. Reduce the quantity.`
    };
  }
  return { ok: true, value };
}

/** Total number of pages for a result count; at least 1 so the pager is stable. */
export function pageCount(total: number, pageSize: number = SALE_PAGE_SIZE): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Keeps a page number within range for the given total. */
export function clampPage(page: number, total: number, pageSize: number = SALE_PAGE_SIZE): number {
  const last = pageCount(total, pageSize);
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(0, Math.trunc(page)), last - 1);
}
