import { test } from "node:test";
import assert from "node:assert/strict";
import { isMissingRpcFunction } from "../src/lib/supabase/rpc.ts";
import {
  buildInventoryRows,
  filterByExpiryStatus,
  paginateInventory,
  searchInventory,
  type InventoryBatch,
  type InventoryProduct
} from "../src/lib/products/inventory.ts";

// --- isMissingRpcFunction --------------------------------------------------
// This is the guard that decides whether a failed RPC may fall back. It must
// match only "the function does not exist" and never a genuine error, or a real
// failure would be silently hidden.

test("matches the PostgREST code for a missing function", () => {
  assert.equal(
    isMissingRpcFunction({
      code: "PGRST202",
      message: "Could not find the function public.dashboard_metrics(p_soon_days) in the schema cache"
    }),
    true
  );
});

test("matches the missing-function wording when the code is absent", () => {
  assert.equal(
    isMissingRpcFunction({
      message: "Could not find the function public.list_inventory_products(p_search) in the schema cache"
    }),
    true
  );
});

test("does NOT match a function that raised its own exception", () => {
  // A function exists but errored: this must surface, not fall back.
  assert.equal(
    isMissingRpcFunction({
      code: "P0001",
      message: "Insufficient stock in batch"
    }),
    false
  );
  assert.equal(
    isMissingRpcFunction({
      code: "42501",
      message: "permission denied for function record_stock_movement"
    }),
    false
  );
});

test("does NOT match a permission, network or argument error", () => {
  for (const error of [
    { code: "PGRST301", message: "JWT expired" },
    { code: "PGRST204", message: "Could not find the 'foo' column" },
    { code: "22P02", message: "invalid input syntax for type integer" },
    { message: "TypeError: fetch failed" },
    { message: "The result contains 1 rows" }
  ]) {
    assert.equal(isMissingRpcFunction(error), false, JSON.stringify(error));
  }
});

test("tolerates null, undefined and non-object errors", () => {
  assert.equal(isMissingRpcFunction(null), false);
  assert.equal(isMissingRpcFunction(undefined), false);
  assert.equal(isMissingRpcFunction("PGRST202"), false);
  assert.equal(isMissingRpcFunction(42), false);
});

// --- application-side fallback helpers -------------------------------------
// These reproduce what the RPCs do when the database function is not deployed.
// They are the whole point of the fallback, so they are covered directly.

function product(overrides: Partial<InventoryProduct> = {}): InventoryProduct {
  return {
    id: "p1",
    name: "Vitamin C",
    category: "Vitamins",
    image_url: null,
    quantity: 10,
    minimum_stock: 2,
    status: "active",
    ...overrides
  };
}

function batch(overrides: Partial<InventoryBatch> = {}): InventoryBatch {
  return {
    product_id: "p1",
    expiration_date: "2999-01-01",
    quantity_remaining: 5,
    ...overrides
  };
}

const TODAY = new Date("2026-06-15T00:00:00Z");

test("buildInventoryRows attaches batch count and the most urgent status", () => {
  const rows = buildInventoryRows(
    [product({ id: "p1" })],
    [
      batch({ product_id: "p1", expiration_date: "2026-01-01", quantity_remaining: 5 }), // expired
      batch({ product_id: "p1", expiration_date: "2026-07-01", quantity_remaining: 5 }) // soon
    ],
    TODAY
  );
  assert.equal(rows[0].batchCount, 2);
  assert.equal(rows[0].expiryStatus, "expired");
});

test("buildInventoryRows ignores emptied batches for the status but still counts them", () => {
  const rows = buildInventoryRows(
    [product({ id: "p1" })],
    [batch({ product_id: "p1", expiration_date: "2026-01-01", quantity_remaining: 0 })],
    TODAY
  );
  assert.equal(rows[0].batchCount, 1);
  assert.equal(rows[0].expiryStatus, "no_date");
});

test("searchInventory matches case-insensitively and trims", () => {
  const rows = buildInventoryRows([product({ name: "Vitamin C" })], [], TODAY);
  assert.equal(searchInventory(rows, "  vitamin ").length, 1);
  assert.equal(searchInventory(rows, "zinc").length, 0);
  assert.equal(searchInventory(rows, "").length, 1);
});

test("filterByExpiryStatus keeps only the matching status and passes 'all'", () => {
  const rows = buildInventoryRows(
    [product({ id: "a" }), product({ id: "b" })],
    [
      batch({ product_id: "a", expiration_date: "2026-01-01" }),
      batch({ product_id: "b", expiration_date: "2999-01-01" })
    ],
    TODAY
  );
  assert.equal(filterByExpiryStatus(rows, "expired").length, 1);
  assert.equal(filterByExpiryStatus(rows, "expired")[0].id, "a");
  assert.equal(filterByExpiryStatus(rows, "all").length, 2);
});

test("paginateInventory slices, clamps and reports exact totals", () => {
  const rows = buildInventoryRows(
    Array.from({ length: 25 }, (_, i) => product({ id: `p${i}`, name: `Product ${i}` })),
    [],
    TODAY
  );
  const first = paginateInventory(rows, 0, 10);
  assert.equal(first.items.length, 10);
  assert.equal(first.total, 25);
  assert.equal(first.pages, 3);
  assert.equal(first.page, 0);

  const last = paginateInventory(rows, 2, 10);
  assert.equal(last.items.length, 5);
  assert.equal(last.page, 2);

  // An out-of-range page clamps to the last page, matching the RPC.
  const clamped = paginateInventory(rows, 99, 10);
  assert.equal(clamped.page, 2);
});

test("paginateInventory on an empty list stays on page 0 of 1", () => {
  const page = paginateInventory([], 3, 10);
  assert.deepEqual(page.items, []);
  assert.equal(page.total, 0);
  assert.equal(page.page, 0);
  assert.equal(page.pages, 1);
});
