"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";

export type StockActionState = {
  ok: boolean;
  message: string;
};

/**
 * Records a stock movement.
 *
 * Authorization is enforced twice, independently:
 * 1. requireSuperAdmin() checks the role stored in `profiles` for this session.
 * 2. Supabase Row Level Security rejects the insert unless the caller is a
 *    super_admin, so a forged request cannot bypass the check.
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

  const { error: movementError } = await supabase.from("stock_movements").insert({
    product_id: productId,
    movement_type: movementType,
    quantity,
    note: note || null,
    created_by: identity.user.id
  });

  if (movementError) {
    return { ok: false, message: `Could not record movement: ${movementError.message}` };
  }

  // Keep the product's on-hand quantity consistent with the movement.
  const { data: product, error: readError } = await supabase
    .from("products")
    .select("quantity")
    .eq("id", productId)
    .maybeSingle();

  if (readError || !product) {
    return {
      ok: false,
      message: "Movement saved, but the product quantity could not be refreshed."
    };
  }

  const current = Number(product.quantity ?? 0);
  const next =
    movementType === "stock_in"
      ? current + quantity
      : movementType === "stock_out"
        ? Math.max(0, current - quantity)
        : quantity;

  const { error: updateError } = await supabase
    .from("products")
    .update({ quantity: next, updated_at: new Date().toISOString() })
    .eq("id", productId);

  if (updateError) {
    return { ok: false, message: `Movement saved, but stock level update failed: ${updateError.message}` };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/stock");

  return {
    ok: true,
    message:
      movementType === "adjustment"
        ? `Stock adjusted to ${next} units.`
        : `Movement recorded. New quantity: ${next} units.`
  };
}
