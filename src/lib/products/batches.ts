/**
 * Expiration rules for multi-batch inventory.
 *
 * This module holds only the presentation-side expiry logic the UI needs
 * (classification, labels, filtering and date normalisation). It is pure, so it
 * is unit-testable without a database.
 *
 * The authoritative stock logic — batch-number generation, deciding whether a
 * receipt tops up an existing batch or creates a new one, and the FEFO
 * deduction — lives in the database functions (see
 * supabase/migrations/20261117b_atomic_inventory_operations.sql). Keeping it in
 * one place means the browser and the server can never disagree about which
 * batch a unit came from, and the whole operation stays atomic.
 */

/** A batch expiring within this many days is flagged as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

export type ExpiryStatus = "expired" | "expiring_soon" | "valid" | "no_date";

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Whole days from `today` to `expirationDate`; null when there is no valid date. */
export function daysUntilDate(
  expirationDate: string | null | undefined,
  today: Date = new Date()
): number | null {
  if (!expirationDate) return null;
  const target = new Date(expirationDate);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((startOfDay(target).getTime() - startOfDay(today).getTime()) / 86_400_000);
}

/**
 * Classifies a batch expiration date.
 *
 * Expiry is measured against the start of today so a batch that expires today
 * counts as expiring soon, not expired, and one that expired yesterday counts
 * as expired.
 */
export function classifyExpiry(
  expirationDate: string | null | undefined,
  today: Date = new Date(),
  soonDays: number = EXPIRING_SOON_DAYS
): ExpiryStatus {
  const days = daysUntilDate(expirationDate, today);
  if (days === null) return "no_date";
  if (days < 0) return "expired";
  if (days <= soonDays) return "expiring_soon";
  return "valid";
}

export const EXPIRY_LABEL: Record<ExpiryStatus, string> = {
  expired: "Expired",
  expiring_soon: "Expiring soon",
  valid: "Valid",
  no_date: "No date"
};

/** Human message for a batch, e.g. "Expires today", "42 days left". */
export function expiryDetail(
  expirationDate: string | null | undefined,
  today: Date = new Date(),
  soonDays: number = EXPIRING_SOON_DAYS
): string {
  const days = daysUntilDate(expirationDate, today);
  if (days === null) return "No expiration date";
  if (days < 0) return `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "Expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

/**
 * Filters batches by expiry status. "all" keeps everything; "valid" means
 * not expired and not expiring soon, matching the inventory filter options.
 */
export function filterBatchesByExpiry<T extends { expiration_date: string | null }>(
  batches: T[],
  status: ExpiryStatus | "all",
  today: Date = new Date(),
  soonDays: number = EXPIRING_SOON_DAYS
): T[] {
  if (status === "all") return batches;
  return batches.filter(
    (batch) => classifyExpiry(batch.expiration_date, today, soonDays) === status
  );
}

/** Normalises a date string to `YYYY-MM-DD`, or null when it is not a valid date. */
export function normalizeDateString(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
