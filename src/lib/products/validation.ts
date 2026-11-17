import type { ProductInput, ProductRecord } from "@/lib/products/types";

export type ValidationResult =
  | { ok: true; value: ProductInput }
  | { ok: false; errors: Record<string, string> };

const MAX = {
  name: 160,
  sku: 64,
  barcode: 64,
  category: 80,
  description: 2000,
  shelf: 40
};

function text(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

/** Empty strings become null so optional columns stay clean in the database. */
function optional(value: string, max: number, errors: Record<string, string>, key: string): string | null {
  if (!value) return null;
  if (value.length > max) {
    errors[key] = `Must be ${max} characters or fewer.`;
    return null;
  }
  return value;
}

function amount(raw: string, label: string, errors: Record<string, string>, key: string): number {
  if (raw === "") return 0;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    errors[key] = `${label} must be a number.`;
    return 0;
  }
  if (value < 0) {
    errors[key] = `${label} cannot be negative.`;
    return 0;
  }
  if (value > 99_999_999.99) {
    errors[key] = `${label} is too large.`;
    return 0;
  }
  return Math.round(value * 100) / 100;
}

function wholeNumber(raw: string, label: string, errors: Record<string, string>, key: string): number {
  if (raw === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    errors[key] = `${label} must be a whole number.`;
    return 0;
  }
  if (value < 0) {
    errors[key] = `${label} cannot be negative.`;
    return 0;
  }
  if (value > 1_000_000) {
    errors[key] = `${label} is too large.`;
    return 0;
  }
  return value;
}

function checkbox(form: FormData, key: string): boolean {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}

/**
 * Validates and normalises a product form.
 *
 * Runs on the server before any write, so a forged request cannot bypass the
 * rules. Uniqueness of SKU and barcode is checked case-insensitively here and
 * is additionally guaranteed by the database unique constraints.
 */
export function validateProductInput(
  form: FormData,
  existing: ProductRecord[],
  currentId: string | null
): ValidationResult {
  const errors: Record<string, string> = {};

  const name = text(form, "name");
  if (!name) errors.name = "Name is required.";
  else if (name.length > MAX.name) errors.name = `Name must be ${MAX.name} characters or fewer.`;

  const skuRaw = text(form, "sku");
  const barcodeRaw = text(form, "barcode");
  const sku = optional(skuRaw, MAX.sku, errors, "sku");
  const barcode = optional(barcodeRaw, MAX.barcode, errors, "barcode");

  const others = existing.filter((product) => product.id !== currentId);

  if (sku && others.some((product) => (product.sku ?? "").toLowerCase() === sku.toLowerCase())) {
    errors.sku = "Another product already uses this SKU.";
  }
  if (
    barcode &&
    others.some((product) => (product.barcode ?? "").toLowerCase() === barcode.toLowerCase())
  ) {
    errors.barcode = "Another product already uses this barcode.";
  }

  const value: ProductInput = {
    name,
    sku,
    barcode,
    category: optional(text(form, "category"), MAX.category, errors, "category"),
    description: optional(text(form, "description"), MAX.description, errors, "description"),
    purchase_price: amount(text(form, "purchase_price"), "Cost price", errors, "purchase_price"),
    selling_price: amount(text(form, "selling_price"), "Selling price", errors, "selling_price"),
    minimum_stock: wholeNumber(text(form, "minimum_stock"), "Reorder level", errors, "minimum_stock"),
    shelf_number: optional(text(form, "shelf_number"), MAX.shelf, errors, "shelf_number"),
    image_url: optional(text(form, "image_url"), 600, errors, "image_url"),
    is_visible_on_homepage: checkbox(form, "is_visible_on_homepage"),
    is_featured: checkbox(form, "is_featured")
  };

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/** First error message, for the single-message action state. */
export function firstError(errors: Record<string, string>): string {
  const first = Object.values(errors)[0];
  return first ?? "Please correct the highlighted fields.";
}
