import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyExpiry,
  daysUntilDate,
  expiryDetail,
  filterBatchesByExpiry,
  normalizeDateString
} from "../src/lib/products/batches.ts";

const TODAY = new Date("2026-06-15T09:00:00Z");


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
