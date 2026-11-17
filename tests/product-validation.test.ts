import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductInput, firstError } from "../src/lib/products/validation.ts";
import type { ProductRecord } from "../src/lib/products/types.ts";

function record(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "p1",
    name: "Existing",
    description: null,
    category: null,
    sku: "SKU-1",
    barcode: "111",
    image_url: null,
    purchase_price: 0,
    selling_price: 0,
    quantity: 0,
    minimum_stock: 0,
    shelf_number: null,
    status: "active",
    is_visible_on_homepage: false,
    is_featured: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = { name: "Vitamin C", sku: "NEW-SKU", barcode: "222", purchase_price: "100", selling_price: "150" };

test("accepts a valid product and normalises numbers", () => {
  const result = validateProductInput(form(valid), [], null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.name, "Vitamin C");
  assert.equal(result.value.purchase_price, 100);
  assert.equal(result.value.selling_price, 150);
});

test("requires a name", () => {
  const result = validateProductInput(form({ ...valid, name: "  " }), [], null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.name);
});

test("rejects a duplicate SKU, case-insensitively", () => {
  const result = validateProductInput(
    form({ ...valid, sku: "sku-1" }),
    [record({ id: "other", sku: "SKU-1" })],
    null
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.sku);
});

test("rejects a duplicate barcode", () => {
  const result = validateProductInput(
    form({ ...valid, barcode: "111" }),
    [record({ id: "other", barcode: "111" })],
    null
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.barcode);
});

test("allows a product to keep its own SKU and barcode when editing", () => {
  const existing = record({ id: "p1", sku: "SKU-1", barcode: "111" });
  const result = validateProductInput(form({ ...valid, sku: "SKU-1", barcode: "111" }), [existing], "p1");
  assert.equal(result.ok, true);
});

test("treats empty optional fields as null", () => {
  const result = validateProductInput(
    form({ ...valid, sku: "", barcode: "", category: "", description: "" }),
    [],
    null
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sku, null);
  assert.equal(result.value.barcode, null);
  assert.equal(result.value.category, null);
});

test("rejects a negative price", () => {
  const result = validateProductInput(form({ ...valid, selling_price: "-5" }), [], null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.selling_price);
});

test("rejects a non-integer reorder level", () => {
  const result = validateProductInput(form({ ...valid, minimum_stock: "2.5" }), [], null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.minimum_stock);
});

test("rejects a non-numeric price", () => {
  const result = validateProductInput(form({ ...valid, purchase_price: "abc" }), [], null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.purchase_price);
});

test("rejects an over-long name", () => {
  const result = validateProductInput(form({ ...valid, name: "x".repeat(200) }), [], null);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.name);
});

test("reads checkboxes and defaults them to false", () => {
  const on = validateProductInput(form({ ...valid, is_featured: "on" }), [], null);
  assert.equal(on.ok, true);
  if (on.ok) assert.equal(on.value.is_featured, true);

  const off = validateProductInput(form(valid), [], null);
  assert.equal(off.ok, true);
  if (off.ok) assert.equal(off.value.is_featured, false);
});

test("the validated value never contains a quantity field", () => {
  const result = validateProductInput(form({ ...valid, quantity: "999" }), [], null);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal("quantity" in result.value, false);
});

test("firstError returns a message", () => {
  assert.equal(firstError({}), "Please correct the highlighted fields.");
  assert.equal(firstError({ name: "Name is required." }), "Name is required.");
});
