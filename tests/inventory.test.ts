import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INVENTORY_PAGE_SIZE,
  isExpiryStatus,
  mapInventoryItems,
  toInventoryPage,
  type InventoryListItem
} from "../src/lib/products/inventory.ts";
import { pageCount, clampPage } from "../src/lib/products/pagination.ts";

function item(overrides: Partial<InventoryListItem> = {}): InventoryListItem {
  return {
    id: "p1",
    name: "Vitamin C",
    category: "Vitamins",
    image_url: null,
    quantity: 10,
    minimum_stock: 2,
    status: "active",
    batch_count: 2,
    expiry_status: "valid",
    ...overrides
  };
}

// --- isExpiryStatus --------------------------------------------------------
test("isExpiryStatus accepts the four statuses and rejects anything else", () => {
  for (const status of ["expired", "expiring_soon", "valid", "no_date"]) {
    assert.equal(isExpiryStatus(status), true);
  }
  assert.equal(isExpiryStatus("bogus"), false);
  assert.equal(isExpiryStatus(undefined), false);
  assert.equal(isExpiryStatus(null), false);
  assert.equal(isExpiryStatus(3), false);
});

// --- mapInventoryItems -----------------------------------------------------
test("mapInventoryItems maps the RPC columns to the list shape", () => {
  const rows = mapInventoryItems([
    item({ id: "a", batch_count: 3, expiry_status: "expired" })
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "a");
  assert.equal(rows[0].batchCount, 3);
  assert.equal(rows[0].expiryStatus, "expired");
  // The snake_case fields are not leaked into the rendered shape.
  assert.equal("batch_count" in rows[0], false);
});

test("mapInventoryItems falls back to no_date for an unknown status", () => {
  const rows = mapInventoryItems([item({ expiry_status: "???" })]);
  assert.equal(rows[0].expiryStatus, "no_date");
});

// --- toInventoryPage -------------------------------------------------------
test("toInventoryPage reads the total, page and page count from the payload", () => {
  const page = toInventoryPage({
    items: [item({ id: "a" }), item({ id: "b" })],
    total: 25,
    page: 1,
    pages: 3
  });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 25);
  assert.equal(page.page, 1);
  assert.equal(page.pages, 3);
});

test("toInventoryPage tolerates a missing payload", () => {
  const page = toInventoryPage(null);
  assert.deepEqual(page.items, []);
  assert.equal(page.total, 0);
  assert.equal(page.page, 0);
  assert.equal(page.pages, 1);
});

test("toInventoryPage clamps an out-of-range page and keeps pages at least one", () => {
  const high = toInventoryPage({ items: [], total: 5, page: 99, pages: 1 });
  assert.equal(high.page, 0);
  const low = toInventoryPage({ items: [], total: 5, page: -4, pages: 2 });
  assert.equal(low.page, 0);
});

test("toInventoryPage derives a sensible total when the payload omits it", () => {
  const page = toInventoryPage({ items: [item(), item()] });
  assert.equal(page.total, 2);
  assert.equal(page.pages, 1);
});

// --- shared page arithmetic ------------------------------------------------
test("the inventory page size is positive", () => {
  assert.ok(INVENTORY_PAGE_SIZE > 0);
});

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
