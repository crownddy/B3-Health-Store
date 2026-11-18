export type ProductReferences = {
  stockMovements: number;
  batches: number;
};

/**
 * How a product should be removed from the active catalogue.
 *
 * A product with no history is hard deleted — there is nothing to preserve and
 * removing the row keeps the table clean. A product with batches or stock
 * movements must keep that history: `stock_movements.product_id` and
 * `product_batches.product_id` are `on delete restrict`, so the row cannot be
 * removed without destroying the audit trail. For those, the product is soft
 * deleted (hidden from every active screen) and its history is left untouched.
 *
 * Deletion is never refused. The caller uses the plan to decide whether to
 * `DELETE` the row or set the soft-delete marker, and to pick the message.
 *
 * Kept pure so the rule is unit tested independently of the database.
 */
export type DeletePlan =
  | { mode: "hard" }
  | { mode: "soft"; reason: string };

export function planProductDeletion(references: ProductReferences): DeletePlan {
  if (references.stockMovements === 0 && references.batches === 0) {
    return { mode: "hard" };
  }

  const parts: string[] = [];
  if (references.batches > 0) {
    parts.push(`${references.batches} batch${references.batches === 1 ? "" : "es"}`);
  }
  if (references.stockMovements > 0) {
    parts.push(
      `${references.stockMovements} stock movement${references.stockMovements === 1 ? "" : "s"}`
    );
  }

  return {
    mode: "soft",
    reason: `This product has ${parts.join(" and ")}. It will be removed from the catalogue, but its history is kept.`
  };
}
