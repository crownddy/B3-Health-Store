import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SALE_PAGE_SIZE,
  validateSaleQuantity,
  pageCount,
  clampPage
} from "../src/lib/products/sale.ts";

// --- validateSaleQuantity --------------------------------------------------
test("requires a quantity", () => {
  const result = validateSaleQuantity("", 10);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Enter the quantity/i);
});

test("rejects a non-integer quantity", () => {
  const result = validateSaleQuantity("1.5", 10);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /whole number/i);
});

test("rejects zero and negative quantities", () => {
  const zero = validateSaleQuantity("0", 10);
  assert.equal(zero.ok, false);
  const negative = validateSaleQuantity("-3", 10);
  assert.equal(negative.ok, false);
  if (!negative.ok) assert.match(negative.message, /greater than zero/i);
});

test("accepts a whole number within the available quantity", () => {
  const result = validateSaleQuantity("4", 10);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 4);
});

test("accepts selling exactly the available quantity", () => {
  const result = validateSaleQuantity("10", 10);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 10);
});

test("rejects more than is available and names the limit", () => {
  const result = validateSaleQuantity("11", 10);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Only 10 units/);
});

test("uses the singular unit for a single available unit", () => {
  const result = validateSaleQuantity("2", 1);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.message, /Only 1 unit in stock/);
});

test("trims surrounding whitespace", () => {
  const result = validateSaleQuantity("  3  ", 10);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value, 3);
});

// --- pagination ------------------------------------------------------------
test("pageCount is at least one, even for an empty result", () => {
  assert.equal(pageCount(0), 1);
});

test("pageCount rounds up partial pages", () => {
  assert.equal(pageCount(1, SALE_PAGE_SIZE), 1);
  assert.equal(pageCount(SALE_PAGE_SIZE, SALE_PAGE_SIZE), 1);
  assert.equal(pageCount(SALE_PAGE_SIZE + 1, SALE_PAGE_SIZE), 2);
  assert.equal(pageCount(SALE_PAGE_SIZE * 3, SALE_PAGE_SIZE), 3);
});

test("clampPage keeps the page inside the valid range", () => {
  assert.equal(clampPage(-4, 20, SALE_PAGE_SIZE), 0);
  assert.equal(clampPage(0, 20, SALE_PAGE_SIZE), 0);
  assert.equal(clampPage(99, 20, SALE_PAGE_SIZE), pageCount(20, SALE_PAGE_SIZE) - 1);
});

test("clampPage falls back to the first page for an empty result", () => {
  assert.equal(clampPage(5, 0, SALE_PAGE_SIZE), 0);
});

test("clampPage truncates a fractional page", () => {
  assert.equal(clampPage(1.9, 100, SALE_PAGE_SIZE), 1);
});
