import type { InitialStockInput, ProductInput, ProductRecord } from "@/lib/products/types";

export type ValidationResult =
  | { ok: true; value: ProductInput }
  | { ok: false; errors: Record<string, string> };

const MAX = {
  name: 160,
  sku: 64,
  barcode: 64,
  category: 80,
  description: 2000,
  shelf: 40,
  batch: 80
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
 *
 * SKU, barcode, cost price and reorder level are no longer shown in the admin
 * UI, so the form does not submit them. When a field is absent from the form
 * (as opposed to submitted empty) the current stored value is carried over, so
 * an ordinary edit never blanks data that was entered before those fields were
 * hidden.
 */
export function validateProductInput(
  form: FormData,
  existing: ProductRecord[],
  currentId: string | null
): ValidationResult {
  const errors: Record<string, string> = {};
  const current = currentId ? existing.find((product) => product.id === currentId) ?? null : null;

  /** The submitted value, or the stored one when the field is not on the form. */
  const kept = (key: string): string =>
    form.has(key) ? text(form, key) : String(current?.[key as keyof ProductRecord] ?? "");

  const name = text(form, "name");
  if (!name) errors.name = "Name is required.";
  else if (name.length > MAX.name) errors.name = `Name must be ${MAX.name} characters or fewer.`;

  const skuRaw = kept("sku");
  const barcodeRaw = kept("barcode");
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
    purchase_price: amount(kept("purchase_price"), "Cost price", errors, "purchase_price"),
    selling_price: amount(text(form, "selling_price"), "Selling price", errors, "selling_price"),
    minimum_stock: wholeNumber(kept("minimum_stock"), "Reorder level", errors, "minimum_stock"),
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

export type InitialStockResult =
  | { ok: true; value: InitialStockInput | null }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates the optional Initial Stock section of the Add Product form.
 *
 * Returns `null` when no initial quantity was entered, so the product is
 * created without a batch. A quantity requires a whole number greater than
 * zero; the batch number stays optional and is generated later if omitted.
 */
export function validateInitialStock(form: FormData): InitialStockResult {
  const errors: Record<string, string> = {};
  const rawQuantity = text(form, "initial_quantity");

  if (rawQuantity === "" || Number(rawQuantity) === 0) {
    return { ok: true, value: null };
  }

  const quantity = wholeNumber(rawQuantity, "Initial quantity", errors, "initial_quantity");
  if (quantity <= 0 && !errors.initial_quantity) {
    errors.initial_quantity = "Initial quantity must be a whole number greater than zero.";
  }

  const expirationRaw = text(form, "initial_expiration_date");
  let expiration: string | null = null;
  if (expirationRaw) {
    const parsed = new Date(expirationRaw);
    if (Number.isNaN(parsed.getTime())) {
      errors.initial_expiration_date = "Enter a valid expiration date.";
    } else {
      expiration = expirationRaw;
    }
  }

  const batchNumber = optional(text(form, "initial_batch_number"), MAX.batch, errors, "initial_batch_number");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { quantity, expiration_date: expiration, batch_number: batchNumber }
  };
}
