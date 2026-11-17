import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExpiry,
  daysUntilDate,
  expiryDetail,
  filterBatchesByExpiry,
  generateBatchNumber,
  normalizeDateString,
  resolveReceiptTarget,
  compareFefo,
  planFefo,
  type BatchLike
} from "../src/lib/products/batches.ts";

const TODAY = new Date("2026-06-15T09:00:00Z");

function batch(overrides: Partial<BatchLike> = {}): BatchLike {
  return {
    id: "b1",
    batch_number: "B1",
    expiration_date: "2026-12-01",
    quantity_remaining: 10,
    ...overrides
  };
}

// --- Expiry classification -------------------------------------------------
test("daysUntilDate counts whole days and is null without a date", () => {
  assert.equal(daysUntilDate("2026-06-15", TODAY), 0);
  assert.equal(daysUntilDate("2026-06-20", TODAY), 5);
  assert.equal(daysUntilDate("2026-06-10", TODAY), -5);
  assert.equal(daysUntilDate(null, TODAY), null);
  assert.equal(daysUntilDate("not-a-date", TODAY), null);
});

test("classifyExpiry marks past dates expired", () => {
  assert.equal(classifyExpiry("2026-06-14", TODAY), "expired");
  assert.equal(classifyExpiry("2020-01-01", TODAY), "expired");
});

test("classifyExpiry marks today and the next 30 days as expiring soon", () => {
  assert.equal(classifyExpiry("2026-06-15", TODAY), "expiring_soon");
  assert.equal(classifyExpiry("2026-07-15", TODAY), "expiring_soon");
});

test("classifyExpiry marks later dates valid and missing dates as no_date", () => {
  assert.equal(classifyExpiry("2026-07-16", TODAY), "valid");
  assert.equal(classifyExpiry("2027-01-01", TODAY), "valid");
  assert.equal(classifyExpiry(null, TODAY), "no_date");
  assert.equal(classifyExpiry("", TODAY), "no_date");
});

test("expiryDetail describes each state in words", () => {
  assert.equal(expiryDetail("2026-06-15", TODAY), "Expires today");
  assert.equal(expiryDetail("2026-06-20", TODAY), "5 days left");
  assert.equal(expiryDetail("2026-06-16", TODAY), "1 day left");
  assert.equal(expiryDetail("2026-06-14", TODAY), "Expired 1 day ago");
  assert.equal(expiryDetail("2026-06-10", TODAY), "Expired 5 days ago");
  assert.equal(expiryDetail(null, TODAY), "No expiration date");
});

test("filterBatchesByExpiry selects a status and keeps everything for all", () => {
  const rows = [
    { expiration_date: "2026-06-01" },
    { expiration_date: "2026-06-20" },
    { expiration_date: "2026-12-01" },
    { expiration_date: null }
  ];
  assert.equal(filterBatchesByExpiry(rows, "all", TODAY).length, 4);
  assert.deepEqual(
    filterBatchesByExpiry(rows, "expired", TODAY).map((r) => r.expiration_date),
    ["2026-06-01"]
  );
  assert.deepEqual(
    filterBatchesByExpiry(rows, "expiring_soon", TODAY).map((r) => r.expiration_date),
    ["2026-06-20"]
  );
  assert.deepEqual(
    filterBatchesByExpiry(rows, "valid", TODAY).map((r) => r.expiration_date),
    ["2026-12-01"]
  );
  assert.deepEqual(
    filterBatchesByExpiry(rows, "no_date", TODAY).map((r) => r.expiration_date),
    [null]
  );
});

test("normalizeDateString keeps valid dates and rejects junk", () => {
  assert.equal(normalizeDateString("2026-06-15"), "2026-06-15");
  assert.equal(normalizeDateString(""), null);
  assert.equal(normalizeDateString(null), null);
  assert.equal(normalizeDateString("nonsense"), null);
});

// --- Batch number generation ----------------------------------------------
test("generateBatchNumber is date-stamped and unique", () => {
  assert.equal(generateBatchNumber(TODAY, []), "B3-20260615");
  assert.equal(generateBatchNumber(TODAY, ["B3-20260615"]), "B3-20260615-2");
  assert.equal(generateBatchNumber(TODAY, ["B3-20260615", "B3-20260615-2"]), "B3-20260615-3");
});

// --- Receipt targeting -----------------------------------------------------
test("resolveReceiptTarget creates a new batch and generates a number", () => {
  const target = resolveReceiptTarget([], null, "2027-01-01", TODAY);
  assert.deepEqual(target, { kind: "create", batchNumber: "B3-20260615" });
});

test("resolveReceiptTarget tops up a batch with the same number and expiry", () => {
  const batches = [batch({ id: "x", batch_number: "LOT-1", expiration_date: "2027-01-01" })];
  const target = resolveReceiptTarget(batches, "LOT-1", "2027-01-01", TODAY);
  assert.deepEqual(target, { kind: "accumulate", batchId: "x" });
});

test("resolveReceiptTarget never reuses a number that has a different expiry", () => {
  const batches = [batch({ id: "x", batch_number: "LOT-1", expiration_date: "2027-01-01" })];
  const target = resolveReceiptTarget(batches, "LOT-1", "2027-06-01", TODAY);
  assert.equal(target.kind, "create");
  // The existing batch keeps its expiry; the new one gets a distinct number.
  if (target.kind === "create") assert.notEqual(target.batchNumber, "LOT-1");
});

test("resolveReceiptTarget keeps a supplied number when it is new", () => {
  const batches = [batch({ id: "x", batch_number: "LOT-1" })];
  const target = resolveReceiptTarget(batches, "LOT-9", "2027-01-01", TODAY);
  assert.deepEqual(target, { kind: "create", batchNumber: "LOT-9" });
});

// --- FEFO ------------------------------------------------------------------
test("compareFefo orders earliest expiry first and undated last", () => {
  const rows = [
    batch({ id: "late", expiration_date: "2027-01-01" }),
    batch({ id: "none", expiration_date: null }),
    batch({ id: "early", expiration_date: "2026-08-01" })
  ].sort(compareFefo);
  assert.deepEqual(rows.map((r) => r.id), ["early", "late", "none"]);
});

test("planFefo deducts from the earliest-expiring batch first", () => {
  const batches = [
    batch({ id: "late", expiration_date: "2027-01-01", quantity_remaining: 10 }),
    batch({ id: "early", expiration_date: "2026-08-01", quantity_remaining: 4 })
  ];
  const plan = planFefo(batches, 4, 14, TODAY);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.deductions, [
    { batchId: "early", batchNumber: "B1", quantity: 4 }
  ]);
  assert.equal(plan.unbatchedQuantity, 0);
});

test("planFefo spans multiple batches when the quantity is larger", () => {
  const batches = [
    batch({ id: "early", expiration_date: "2026-08-01", quantity_remaining: 4 }),
    batch({ id: "mid", expiration_date: "2026-10-01", quantity_remaining: 6 }),
    batch({ id: "late", expiration_date: "2027-01-01", quantity_remaining: 10 })
  ];
  const plan = planFefo(batches, 8, 20, TODAY);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.deductions, [
    { batchId: "early", batchNumber: "B1", quantity: 4 },
    { batchId: "mid", batchNumber: "B1", quantity: 4 }
  ]);
});

test("planFefo never sells expired batches", () => {
  const batches = [
    batch({ id: "expired", expiration_date: "2026-01-01", quantity_remaining: 50 }),
    batch({ id: "valid", expiration_date: "2027-01-01", quantity_remaining: 3 })
  ];
  const plan = planFefo(batches, 3, 53, TODAY);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.deductions, [{ batchId: "valid", batchNumber: "B1", quantity: 3 }]);
});

test("planFefo refuses to sell more than is available", () => {
  const batches = [batch({ id: "a", expiration_date: "2027-01-01", quantity_remaining: 3 })];
  const plan = planFefo(batches, 5, 3, TODAY);
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.available, 3);
  assert.match(plan.reason, /Only 3 units/);
});

test("planFefo falls back to unbatched stock for legacy products", () => {
  const plan = planFefo([], 5, 10, TODAY);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.deductions, []);
  assert.equal(plan.unbatchedQuantity, 5);
});

test("planFefo rejects a non-positive quantity", () => {
  assert.equal(planFefo([], 0, 10, TODAY).ok, false);
  assert.equal(planFefo([], -3, 10, TODAY).ok, false);
});
