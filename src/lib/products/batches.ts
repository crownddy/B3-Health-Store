/**
 * Batch and expiration rules for multi-batch inventory.
 *
 * Everything here is pure so the expiry classification, batch-number
 * generation, receipt targeting and the FEFO (First Expired, First Out)
 * deduction plan can be unit tested without a database. The server actions
 * perform the actual reads and writes using these decisions.
 */

/** A batch expiring within this many days is flagged as "expiring soon". */
export const EXPIRING_SOON_DAYS = 30;

export type ExpiryStatus = "expired" | "expiring_soon" | "valid" | "no_date";

/** The subset of a batch these rules need. */
export type BatchLike = {
  id: string;
  batch_number: string | null;
  expiration_date: string | null;
  quantity_remaining: number;
};

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

/**
 * Generates a batch number when the user does not supply one.
 *
 * The number is date-stamped and made unique against the numbers already used
 * for the product, so a generated number never collides with an existing batch.
 */
export function generateBatchNumber(when: Date = new Date(), existing: Iterable<string> = []): string {
  const stamp = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, "0")}${String(
    when.getDate()
  ).padStart(2, "0")}`;
  const base = `B3-${stamp}`;
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export type ReceiptTarget =
  | { kind: "accumulate"; batchId: string }
  | { kind: "create"; batchNumber: string };

/**
 * Decides where a stock receipt lands.
 *
 * A receipt joins an existing batch only when the supplied batch number matches
 * AND the expiration date is identical, so a different batch (or the same
 * number with a different expiry) never overwrites an existing batch's
 * expiration date. It is given a fresh, unique batch number instead.
 */
export function resolveReceiptTarget(
  batches: BatchLike[],
  suppliedNumber: string | null,
  expirationDate: string | null,
  when: Date = new Date()
): ReceiptTarget {
  const number = (suppliedNumber ?? "").trim();
  const existingNumbers = batches
    .map((batch) => (batch.batch_number ?? "").trim())
    .filter((value) => value.length > 0);

  if (number) {
    const sameNumber = batches.filter((batch) => (batch.batch_number ?? "").trim() === number);
    const match = sameNumber.find(
      (batch) => normalizeDateString(batch.expiration_date) === normalizeDateString(expirationDate)
    );
    if (match) return { kind: "accumulate", batchId: match.id };
    // A different batch already uses this number with another expiry. Keep that
    // batch untouched and create the new one under a distinct number.
    if (sameNumber.length > 0) {
      return { kind: "create", batchNumber: generateBatchNumber(when, existingNumbers) };
    }
    return { kind: "create", batchNumber: number };
  }

  return { kind: "create", batchNumber: generateBatchNumber(when, existingNumbers) };
}

/** Orders batches for FEFO: earliest expiration first, undated batches last. */
export function compareFefo(a: BatchLike, b: BatchLike): number {
  const left = a.expiration_date ? Date.parse(a.expiration_date) : null;
  const right = b.expiration_date ? Date.parse(b.expiration_date) : null;
  if (left === null && right === null) return a.id.localeCompare(b.id);
  if (left === null) return 1;
  if (right === null) return -1;
  if (left !== right) return left - right;
  return a.id.localeCompare(b.id);
}

export type FefoDeduction = {
  batchId: string;
  batchNumber: string | null;
  quantity: number;
};

export type FefoPlan =
  | { ok: true; deductions: FefoDeduction[]; unbatchedQuantity: number; available: number }
  | { ok: false; reason: string; available: number };

/**
 * Builds the FEFO deduction plan for a stock-out.
 *
 * Batches are consumed earliest-expiry-first. Expired batches are never
 * deducted, so expired stock cannot be sold. When a product has stock that is
 * not yet broken into batches (legacy rows), the shortfall is taken from that
 * unbatched portion, keeping the workflow working for products created before
 * batch tracking existed.
 */
export function planFefo(
  batches: BatchLike[],
  requested: number,
  productQuantity: number,
  today: Date = new Date()
): FefoPlan {
  const quantity = Math.trunc(requested);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, reason: "Quantity must be a whole number greater than zero.", available: 0 };
  }

  const totalBatchRemaining = batches.reduce(
    (sum, batch) => sum + Math.max(0, batch.quantity_remaining),
    0
  );
  const unbatchedAvailable = Math.max(0, productQuantity - totalBatchRemaining);

  const sellable = batches
    .filter(
      (batch) => batch.quantity_remaining > 0 && classifyExpiry(batch.expiration_date, today) !== "expired"
    )
    .sort(compareFefo);

  const sellableTotal = sellable.reduce((sum, batch) => sum + batch.quantity_remaining, 0);
  const available = Math.min(productQuantity, sellableTotal + unbatchedAvailable);

  if (quantity > available) {
    return {
      ok: false,
      reason: `Only ${available} unit${available === 1 ? "" : "s"} are available to sell.`,
      available
    };
  }

  const deductions: FefoDeduction[] = [];
  let remaining = quantity;
  for (const batch of sellable) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity_remaining, remaining);
    deductions.push({ batchId: batch.id, batchNumber: batch.batch_number, quantity: take });
    remaining -= take;
  }

  return { ok: true, deductions, unbatchedQuantity: remaining, available };
}
