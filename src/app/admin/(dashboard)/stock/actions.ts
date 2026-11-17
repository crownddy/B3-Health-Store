"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { normalizeDateString } from "@/lib/products/batches";
import { describeWriteError } from "@/lib/products/errors";

export type StockActionState = {
  ok: boolean;
  message: string;
};

function refreshPaths(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/expiry");
}

/**
 * Records a stock movement.
 *
 * Authorization is enforced twice, independently:
 * 1. requireSuperAdmin() checks the role stored in `profiles` for this session.
 * 2. The `record_stock_movement` function checks the role again in PostgreSQL
 *    and raises for anyone else, while Row Level Security independently
 *    restricts the writes it performs.
 *
 * Atomicity: the batch update, the stock movement insert and the products
 * total are all written by the single `record_stock_movement` function, which
 * runs in one transaction. A failure part-way through rolls every write back,
 * so a batch can never be reduced without its movement being recorded, and the
 * total can never drift from the batches. The function takes a row lock on the
 * product (and the affected batches) first, so two concurrent movements cannot
 * oversell or compute a total from stale data.
 *
 * Batch handling (inside the function):
 * - Stock in: each receipt carries its own expiration date. The receipt joins
 *   an existing batch only when both the batch number and the expiration date
 *   match; otherwise a new batch is created, with a generated number when none
 *   is supplied. An existing batch's expiration date is never overwritten.
 * - Stock out: FEFO — units come from the batch with the earliest valid
 *   expiration date first, spanning several batches when needed. Expired
 *   batches are never sold, batch quantities never go negative, and every
 *   movement is recorded so history is preserved.
 */
export async function recordStockMovement(
  _prev: StockActionState | undefined,
  formData: FormData
): Promise<StockActionState> {
  await requireSuperAdmin();

  const productId = String(formData.get("product_id") ?? "").trim();
  const movementType = String(formData.get("movement_type") ?? "").trim();
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!productId) return { ok: false, message: "Select a product." };
  if (!["stock_in", "stock_out", "adjustment"].includes(movementType)) {
    return { ok: false, message: "Select a valid movement type." };
  }

  const quantity = Number.parseInt(quantityRaw, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, message: "Quantity must be a whole number greater than zero." };
  }

  // The expiration date only applies to a receipt. Validate it here so the user
  // gets a clear message; the function stores exactly what it is given.
  let expirationDate: string | null = null;
  let batchNumber: string | null = null;
  if (movementType === "stock_in") {
    const rawExpiration = String(formData.get("expiration_date") ?? "").trim();
    if (rawExpiration) {
      expirationDate = normalizeDateString(rawExpiration);
      if (!expirationDate) return { ok: false, message: "Enter a valid expiration date." };
    }
    batchNumber = String(formData.get("batch_number") ?? "").trim() || null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_stock_movement", {
    p_product_id: productId,
    p_movement_type: movementType,
    p_quantity: quantity,
    p_note: note || null,
    p_batch_number: batchNumber,
    p_expiration_date: expirationDate
  });

  if (error) return { ok: false, message: describeWriteError(error) };

  const next = Number((data as { quantity?: number } | null)?.quantity ?? 0);
  refreshPaths();

  if (movementType === "stock_in") {
    return { ok: true, message: `Stock received. New quantity: ${next} units.` };
  }
  if (movementType === "stock_out") {
    return { ok: true, message: `Stock issued (FEFO). New quantity: ${next} units.` };
  }
  return { ok: true, message: `Stock adjusted to ${next} units.` };
}
