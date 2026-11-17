import { test } from "node:test";
import assert from "node:assert/strict";
import { filterProducts, collectCategories } from "../src/lib/products/query.ts";
import { canDeleteProduct } from "../src/lib/products/policy.ts";
import { stockStatus } from "../src/lib/products/stock.ts";
import { describeWriteError } from "../src/lib/products/errors.ts";
import type { ProductRecord } from "../src/lib/products/types.ts";

function record(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "p1",
    name: "Vitamin C",
    description: null,
    category: "Vitamins",
    sku: "VIT-C",
    barcode: "111",
    image_url: null,
    purchase_price: 100,
    selling_price: 150,
    quantity: 10,
    minimum_stock: 2,
    shelf_number: null,
    status: "active",
    is_visible_on_homepage: true,
    is_featured: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

const catalogue: ProductRecord[] = [
  record({ id: "a", name: "Vitamin C", sku: "VIT-C", barcode: "111", category: "Vitamins" }),
  record({ id: "b", name: "Herbal Tea", sku: "TEA-1", barcode: "222", category: "Wellness", status: "archived" }),
  record({ id: "c", name: "Vitamin D", sku: "VIT-D", barcode: null, category: "Vitamins" })
];

test("searches by name", () => {
  const out = filterProducts(catalogue, { search: "herbal" });
  assert.deepEqual(out.map((p) => p.id), ["b"]);
});

test("searches by category", () => {
  const out = filterProducts(catalogue, { search: "wellness" });
  assert.deepEqual(out.map((p) => p.id), ["b"]);
});

test("no longer matches the hidden SKU or barcode fields", () => {
  assert.deepEqual(filterProducts(catalogue, { search: "vit-d" }), []);
  assert.deepEqual(filterProducts(catalogue, { search: "222" }), []);
});

test("filters by status", () => {
  assert.deepEqual(filterProducts(catalogue, { status: "archived" }).map((p) => p.id), ["b"]);
  assert.deepEqual(
    filterProducts(catalogue, { status: "active" }).map((p) => p.id),
    ["a", "c"]
  );
});

test("filters by category, case-insensitively", () => {
  const out = filterProducts(catalogue, { category: "vitamins" });
  assert.deepEqual(out.map((p) => p.id), ["a", "c"]);
});

test("combines search, category and status", () => {
  const out = filterProducts(catalogue, { search: "vit", category: "Vitamins", status: "active" });
  assert.deepEqual(out.map((p) => p.id), ["a", "c"]);
});

test("an empty query returns everything", () => {
  assert.equal(filterProducts(catalogue, {}).length, 3);
});

test("collectCategories returns sorted, distinct names", () => {
  assert.deepEqual(collectCategories(catalogue), ["Vitamins", "Wellness"]);
});

test("canDeleteProduct blocks products with stock movements", () => {
  const decision = canDeleteProduct({ stockMovements: 3, batches: 0 });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.match(decision.reason, /3 stock movements/);
});

test("canDeleteProduct blocks products with batches", () => {
  const decision = canDeleteProduct({ stockMovements: 0, batches: 1 });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.match(decision.reason, /1 batch\b/);
});

test("canDeleteProduct allows an unreferenced product", () => {
  assert.equal(canDeleteProduct({ stockMovements: 0, batches: 0 }).allowed, true);
});

test("stockStatus classifies quantity against the reorder level", () => {
  assert.equal(stockStatus(0, 5).label, "Out of stock");
  assert.equal(stockStatus(5, 5).label, "Low stock");
  assert.equal(stockStatus(4, 5).label, "Low stock");
  assert.equal(stockStatus(6, 5).label, "In stock");
});

test("describeWriteError names the offending field for duplicates", () => {
  assert.match(
    describeWriteError({ code: "23505", message: 'duplicate key value violates unique constraint "products_barcode_key"' }),
    /barcode/
  );
  assert.match(
    describeWriteError({ code: "23505", message: 'duplicate key value violates unique constraint "products_sku_key"' }),
    /SKU/
  );
});

test("describeWriteError explains a blocked delete", () => {
  assert.match(describeWriteError({ code: "23503", message: "violates foreign key" }), /cannot be removed/);
});

test("describeWriteError falls back to the raw message", () => {
  assert.equal(describeWriteError({ code: "XX000", message: "boom" }), "boom");
  assert.equal(describeWriteError(null), "Unknown error.");
});
