"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getProductBatches } from "@/lib/data";
import {
  planFefo,
  resolveReceiptTarget,
  normalizeDateString,
  type BatchLike
} from "@/lib/products/batches";

export type StockActionState = {
  ok: boolean;
  message: string;
};

type MovementContext = {
  productId: string;
  quantity: number;
  note: string;
  current: number;
  userId: string;
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
 * 2. Supabase Row Level Security rejects the write unless the caller is a
 *    super_admin, so a forged request cannot bypass the check.
 *
 * Batch handling:
 * - Stock in: each receipt carries its own expiration date. The receipt joins an
 *   existing batch only when both the batch number and the expiration date
 *   match; otherwise a new batch is created (with a generated number when none
 *   is supplied). An existing batch's expiration date is never overwritten.
 * - Stock out: FEFO — units come from the batch with the earliest valid
 *   expiration date first, spanning several batches when needed. Expired
 *   batches are never sold, batch quantities never go negative, and every
 *   movement is recorded so history is preserved.
 */
export async function recordStockMovement(
  _prev: StockActionState | undefined,
  formData: FormData
): Promise<StockActionState> {
  const identity = await requireSuperAdmin();

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

  const supabase = await createClient();
  const { data: product, error: readError } = await supabase
    .from("products")
    .select("quantity")
    .eq("id", productId)
    .maybeSingle();

  if (readError || !product) return { ok: false, message: "That product could not be found." };

  const context: MovementContext = {
    productId,
    quantity,
    note,
    current: Number(product.quantity ?? 0),
    userId: identity.user.id
  };

  if (movementType === "stock_in") {
    return recordStockIn(supabase, context, {
      batchNumber: String(formData.get("batch_number") ?? "").trim(),
      expirationRaw: String(formData.get("expiration_date") ?? "").trim()
    });
  }
  if (movementType === "stock_out") {
    return recordStockOut(supabase, context);
  }
  return recordAdjustment(supabase, context);
}

async function recordStockIn(
  supabase: SupabaseClient,
  context: MovementContext,
  receipt: { batchNumber: string; expirationRaw: string }
): Promise<StockActionState> {
  const { productId, quantity, note, current, userId } = context;

  let expirationDate: string | null = null;
  if (receipt.expirationRaw) {
    expirationDate = normalizeDateString(receipt.expirationRaw);
    if (!expirationDate) return { ok: false, message: "Enter a valid expiration date." };
  }

  const batches = await getProductBatches(productId);
  const target = resolveReceiptTarget(batches, receipt.batchNumber || null, expirationDate);

  let batchId: string | null = null;

  if (target.kind === "accumulate") {
    const existing = batches.find((batch) => batch.id === target.batchId);
    // Same batch number and expiry: top up the quantities and leave the
    // expiration date exactly as recorded.
    const { error } = await supabase
      .from("product_batches")
      .update({
        quantity_received: Number(existing?.quantity_received ?? 0) + quantity,
        quantity_remaining: Number(existing?.quantity_remaining ?? 0) + quantity
      })
      .eq("id", target.batchId);
    if (error) return { ok: false, message: `Could not update the batch: ${error.message}` };
    batchId = target.batchId;
  } else {
    const { data: batch, error } = await supabase
      .from("product_batches")
      .insert({
        product_id: productId,
        batch_number: target.batchNumber,
        quantity_received: quantity,
        quantity_remaining: quantity,
        expiration_date: expirationDate
      })
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, message: `Could not record the batch: ${error.message}` };
    batchId = batch?.id ?? null;
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    product_id: productId,
    batch_id: batchId,
    movement_type: "stock_in",
    quantity,
    note: note || null,
    created_by: userId
  });
  if (movementError) return { ok: false, message: `Could not record movement: ${movementError.message}` };

  const next = current + quantity;
  const { error: updateError } = await supabase
    .from("products")
    .update({ quantity: next, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (updateError) {
    return { ok: false, message: `Movement saved, but stock level update failed: ${updateError.message}` };
  }

  refreshPaths();
  return { ok: true, message: `Stock received. New quantity: ${next} units.` };
}

async function recordStockOut(
  supabase: SupabaseClient,
  context: MovementContext
): Promise<StockActionState> {
  const { productId, quantity, note, current, userId } = context;

  const batches = await getProductBatches(productId);
  const plan = planFefo(batches as BatchLike[], quantity, current);
  if (!plan.ok) return { ok: false, message: plan.reason };

  // Deduct earliest-expiry-first. quantity_remaining is only ever reduced, and
  // the batch row is never deleted, so batch history survives. The database
  // CHECK (quantity_remaining >= 0) backs up the arithmetic here.
  for (const deduction of plan.deductions) {
    const batch = batches.find((row) => row.id === deduction.batchId);
    const remaining = Number(batch?.quantity_remaining ?? 0) - deduction.quantity;
    if (remaining < 0) {
      return { ok: false, message: "A batch would be left negative. No changes were made." };
    }
    const { error } = await supabase
      .from("product_batches")
      .update({ quantity_remaining: remaining })
      .eq("id", deduction.batchId);
    if (error) return { ok: false, message: `Could not update the batch: ${error.message}` };
  }

  // One movement row per batch (plus one for any unbatched stock), so the
  // history shows exactly which batch each unit came from.
  const movements: Array<{
    product_id: string;
    batch_id: string | null;
    movement_type: "stock_out";
    quantity: number;
    note: string | null;
    created_by: string;
  }> = plan.deductions.map((deduction) => ({
    product_id: productId,
    batch_id: deduction.batchId,
    movement_type: "stock_out" as const,
    quantity: deduction.quantity,
    note: note || null,
    created_by: userId
  }));
  if (plan.unbatchedQuantity > 0) {
    movements.push({
      product_id: productId,
      batch_id: null,
      movement_type: "stock_out" as const,
      quantity: plan.unbatchedQuantity,
      note: note || null,
      created_by: userId
    });
  }

  const { error: movementError } = await supabase.from("stock_movements").insert(movements);
  if (movementError) return { ok: false, message: `Could not record movement: ${movementError.message}` };

  const next = Math.max(0, current - quantity);
  const { error: updateError } = await supabase
    .from("products")
    .update({ quantity: next, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (updateError) {
    return { ok: false, message: `Movement saved, but stock level update failed: ${updateError.message}` };
  }

  refreshPaths();
  return { ok: true, message: `Stock issued (FEFO). New quantity: ${next} units.` };
}

async function recordAdjustment(
  supabase: SupabaseClient,
  context: MovementContext
): Promise<StockActionState> {
  const { productId, quantity, note, userId } = context;

  // An adjustment sets the exact on-hand figure for a stock-count correction.
  // It records a movement but never rewrites batch rows, so batch history is
  // left intact.
  const { error: movementError } = await supabase.from("stock_movements").insert({
    product_id: productId,
    movement_type: "adjustment",
    quantity,
    note: note || null,
    created_by: userId
  });
  if (movementError) return { ok: false, message: `Could not record movement: ${movementError.message}` };

  const { error: updateError } = await supabase
    .from("products")
    .update({ quantity, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (updateError) {
    return { ok: false, message: `Movement saved, but stock level update failed: ${updateError.message}` };
  }

  refreshPaths();
  return { ok: true, message: `Stock adjusted to ${quantity} units.` };
}
