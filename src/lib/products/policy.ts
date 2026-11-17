export type ProductReferences = {
  stockMovements: number;
  batches: number;
};

export type DeleteDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Decides whether a product may be permanently deleted.
 *
 * A product referenced by any historical record must not be deleted:
 * `stock_movements.product_id` is `on delete restrict`, so the database would
 * refuse anyway, and the movement history must stay intact. Archiving is the
 * correct action for a discontinued product.
 *
 * Kept pure so the rule is unit tested independently of the database.
 */
export function canDeleteProduct(references: ProductReferences): DeleteDecision {
  const blockers: string[] = [];
  if (references.stockMovements > 0) {
    blockers.push(`${references.stockMovements} stock movement${references.stockMovements === 1 ? "" : "s"}`);
  }
  if (references.batches > 0) {
    blockers.push(`${references.batches} batch${references.batches === 1 ? "" : "es"}`);
  }

  if (blockers.length === 0) return { allowed: true };
  return {
    allowed: false,
    reason: `This product has ${blockers.join(" and ")}. Archive it instead of deleting, so history is preserved.`
  };
}
