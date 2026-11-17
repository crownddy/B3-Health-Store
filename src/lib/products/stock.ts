export type StockTone = "good" | "warn" | "danger" | "muted";

export type StockStatus = {
  tone: StockTone;
  label: string;
};

/**
 * Human-readable stock availability for a product.
 *
 * `minimum_stock` is the reorder level: at or below it the product is low.
 */
export function stockStatus(quantity: number, minimumStock: number): StockStatus {
  if (quantity <= 0) return { tone: "danger", label: "Out of stock" };
  if (quantity <= minimumStock) return { tone: "warn", label: "Low stock" };
  return { tone: "good", label: "In stock" };
}
