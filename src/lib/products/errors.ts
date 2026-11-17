type SupabaseError = { code?: string | null; message?: string | null } | null;

/**
 * Turns a Postgres error into a message that names the real cause.
 *
 * 23505 is a unique-constraint violation. The database is the final authority
 * on SKU/barcode uniqueness (the application check can race), so this maps the
 * constraint name to the field the user needs to change.
 */
export function describeWriteError(error: SupabaseError): string {
  if (!error) return "Unknown error.";

  if (error.code === "23505") {
    const message = error.message ?? "";
    if (message.includes("barcode")) return "Another product already uses this barcode.";
    if (message.includes("sku")) return "Another product already uses this SKU.";
    return "That value is already used by another product.";
  }

  if (error.code === "23503") {
    return "That product is referenced by other records and cannot be removed.";
  }

  if (error.code === "23514") {
    return "One of the values is outside the allowed range.";
  }

  // Raised by the inventory functions when the caller is not allowed to write.
  if (error.code === "42501") {
    return "You do not have permission to change stock.";
  }
  if (error.code === "28000") {
    return "Your session has expired. Please sign in again.";
  }

  return error.message ?? "The change could not be saved.";
}
