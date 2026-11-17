import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_PAGE_SIZE,
  buildInventoryRows,
  filterByExpiryStatus,
  groupBatchesByProduct,
  paginateInventory,
  searchInventory,
  type InventoryBatch,
  type InventoryProduct
} from "../src/lib/products/inventory.ts";
import { pageCount, clampPage } from "../src/lib/products/pagination.ts";

const TODAY = new Date("2026-06-15T09:00:00Z");

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
    expiration_date: "2027-01-01",
    quantity_remaining: 10,
    ...overrides
  };
}

// --- buildInventoryRows ----------------------------------------------------
test("buildInventoryRows attaches a batch count and expiry status", () => {
  const rows = buildInventoryRows(
    [product()],
    [
      batch({ expiration_date: "2027-01-01" }),
      batch({ expiration_date: "2026-06-01" })
    ],
    TODAY
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].batchCount, 2);
  assert.equal(rows[0].expiryStatus, "expired");
});

test("buildInventoryRows is no_date for a product with no batches", () => {
  const rows = buildInventoryRows([product()], [], TODAY);
  assert.equal(rows[0].batchCount, 0);
  assert.equal(rows[0].expiryStatus, "no_date");
});

test("buildInventoryRows keeps batches with their own product", () => {
  const rows = buildInventoryRows(
    [product({ id: "a", name: "A" }), product({ id: "b", name: "B" })],
    [
      batch({ product_id: "a", expiration_date: "2026-06-01", quantity_remaining: 1 }),
      batch({ product_id: "b", expiration_date: "2027-01-01", quantity_remaining: 1 })
    ],
    TODAY
  );
  const a = rows.find((r) => r.id === "a");
  const b = rows.find((r) => r.id === "b");
  assert.equal(a?.expiryStatus, "expired");
  assert.equal(b?.expiryStatus, "valid");
});

// --- grouping --------------------------------------------------------------
test("groupBatchesByProduct groups by product id", () => {
  const grouped = groupBatchesByProduct([
    batch({ product_id: "a" }),
    batch({ product_id: "a" }),
    batch({ product_id: "b" })
  ]);
  assert.equal(grouped.get("a")?.length, 2);
  assert.equal(grouped.get("b")?.length, 1);
});

// --- search ----------------------------------------------------------------
test("searchInventory matches the product name, case-insensitively", () => {
  const rows = [product({ id: "a", name: "Vitamin C" }), product({ id: "b", name: "Herbal Tea" })];
  assert.deepEqual(
    searchInventory(rows, "vit").map((r) => r.id),
    ["a"]
  );
  assert.deepEqual(
    searchInventory(rows, "  TEA ").map((r) => r.id),
    ["b"]
  );
});

test("searchInventory returns everything for a blank term", () => {
  const rows = [product({ id: "a" }), product({ id: "b" })];
  assert.equal(searchInventory(rows, "   ").length, 2);
});

// --- expiry filter ---------------------------------------------------------
test("filterByExpiryStatus selects one status and keeps everything for all", () => {
  const rows = [
    { name: "a", expiryStatus: "expired" as const },
    { name: "b", expiryStatus: "valid" as const },
    { name: "c", expiryStatus: "expired" as const }
  ];
  assert.equal(filterByExpiryStatus(rows, "all").length, 3);
  assert.deepEqual(
    filterByExpiryStatus(rows, "expired").map((r) => r.name),
    ["a", "c"]
  );
});

// --- pagination ------------------------------------------------------------
test("paginateInventory slices the requested page and clamps out-of-range pages", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `p${i}` }));

  const first = paginateInventory(rows, 0, 10);
  assert.equal(first.items.length, 10);
  assert.equal(first.total, 25);
  assert.equal(first.pages, 3);
  assert.equal(first.items[0].id, "p0");

  const last = paginateInventory(rows, 2, 10);
  assert.equal(last.items.length, 5);
  assert.equal(last.items[0].id, "p20");

  const clamped = paginateInventory(rows, 99, 10);
  assert.equal(clamped.page, 2);
});

test("paginateInventory falls back to the first page for an empty result", () => {
  const page = paginateInventory([], 4, 10);
  assert.equal(page.items.length, 0);
  assert.equal(page.page, 0);
  assert.equal(page.pages, 1);
});

test("the inventory page size is positive", () => {
  assert.ok(INVENTORY_PAGE_SIZE > 0);
});

// --- shared page arithmetic ------------------------------------------------
test("pageCount is at least one and rounds up", () => {
  assert.equal(pageCount(0, 10), 1);
  assert.equal(pageCount(10, 10), 1);
  assert.equal(pageCount(11, 10), 2);
});

test("clampPage keeps a page inside the valid range", () => {
  assert.equal(clampPage(-1, 25, 10), 0);
  assert.equal(clampPage(0, 25, 10), 0);
  assert.equal(clampPage(99, 25, 10), 2);
  assert.equal(clampPage(1.7, 25, 10), 1);
});
