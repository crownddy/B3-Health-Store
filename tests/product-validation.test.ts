import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProductInput, validateInitialStock, firstError } from "../src/lib/products/validation.ts";
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

test("preserves stored SKU, barcode, cost and reorder level when the form omits them", () => {
  // The admin form no longer shows these fields, so an ordinary edit must not
  // blank the values that were stored before they were hidden.
  const existing = record({
    id: "p1",
    sku: "SKU-1",
    barcode: "111",
    purchase_price: 250,
    minimum_stock: 7
  });
  const result = validateProductInput(
    form({ name: "Renamed", selling_price: "150" }),
    [existing],
    "p1"
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sku, "SKU-1");
  assert.equal(result.value.barcode, "111");
  assert.equal(result.value.purchase_price, 250);
  assert.equal(result.value.minimum_stock, 7);
});

test("a submitted empty SKU still clears it on edit", () => {
  const existing = record({ id: "p1", sku: "SKU-1" });
  const result = validateProductInput(form({ ...valid, sku: "" }), [existing], "p1");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sku, null);
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

// --- Initial stock ---------------------------------------------------------
test("validateInitialStock returns null when no quantity is entered", () => {
  const result = validateInitialStock(form({}));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, null);
});

test("validateInitialStock treats a zero quantity as no batch", () => {
  const result = validateInitialStock(form({ initial_quantity: "0" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value, null);
});

test("validateInitialStock accepts a quantity with an expiration date and batch number", () => {
  const result = validateInitialStock(
    form({ initial_quantity: "24", initial_expiration_date: "2027-01-31", initial_batch_number: "LOT-1" })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, {
    quantity: 24,
    expiration_date: "2027-01-31",
    batch_number: "LOT-1"
  });
});

test("validateInitialStock allows a quantity without an expiration date", () => {
  const result = validateInitialStock(form({ initial_quantity: "5" }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value, { quantity: 5, expiration_date: null, batch_number: null });
});

test("validateInitialStock rejects a negative or non-integer quantity", () => {
  const negative = validateInitialStock(form({ initial_quantity: "-4" }));
  assert.equal(negative.ok, false);
  if (!negative.ok) assert.ok(negative.errors.initial_quantity);

  const fractional = validateInitialStock(form({ initial_quantity: "2.5" }));
  assert.equal(fractional.ok, false);
  if (!fractional.ok) assert.ok(fractional.errors.initial_quantity);
});

test("validateInitialStock rejects an invalid expiration date", () => {
  const result = validateInitialStock(
    form({ initial_quantity: "3", initial_expiration_date: "not-a-date" })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.initial_expiration_date);
});

test("validateInitialStock rejects an over-long batch number", () => {
  const result = validateInitialStock(
    form({ initial_quantity: "3", initial_batch_number: "x".repeat(90) })
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.errors.initial_batch_number);
});
