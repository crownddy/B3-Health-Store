"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { describeWriteError } from "@/lib/products/errors";
import { validateSaleQuantity } from "@/lib/products/sale";

export type SaleActionState = {
  ok: boolean;
  message: string;
  /** The product the sale was recorded against, echoed so the form can reset. */
  productId?: string;
};

function refreshPaths(): void {
  revalidatePath("/admin");
  revalidatePath("/admin/sold");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/expiry");
  revalidatePath("/admin/products");
}

/**
 * Records a sale of a product.
 *
 * This deliberately reuses the existing inventory architecture rather than
 * adding a second way to change stock: the sale is a `stock_out` movement
 * recorded by the `record_stock_movement` function
 * (supabase/migrations/20261117b_atomic_inventory_operations.sql). That means
 * FEFO deduction (earliest valid expiry first, spanning batches), never selling
 * expired stock, preserved batch and movement history, and the row-lock that
 * stops two concurrent sales from overselling all apply here unchanged.
 *
 * Authorization is enforced twice, independently: requireSuperAdmin() checks the
 * signed-in role, and the function re-checks it in PostgreSQL and raises, so a
 * forged request cannot bypass either check.
 *
 * `available` is the sellable quantity the page displayed. It is validated here
 * for a clear message; the function is still the authority and will refuse a
 * sale larger than what is actually sellable (for example if another sale won
 * the race, or the batch expired since the page was loaded).
 */
export async function recordSale(
  _prev: SaleActionState | undefined,
  formData: FormData
): Promise<SaleActionState> {
  await requireSuperAdmin();

  const productId = String(formData.get("product_id") ?? "").trim();
  const available = Number(formData.get("available") ?? 0);

  if (!productId) return { ok: false, message: "Select a product to sell." };

  const validation = validateSaleQuantity(String(formData.get("quantity") ?? ""), available);
  if (!validation.ok) return { ok: false, message: validation.message };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_stock_movement", {
    p_product_id: productId,
    p_movement_type: "stock_out",
    p_quantity: validation.value,
    p_note: "Sale",
    p_batch_number: null,
    p_expiration_date: null
  });

  if (error) return { ok: false, message: describeWriteError(error) };

  const remaining = Number((data as { quantity?: number } | null)?.quantity ?? 0);
  refreshPaths();

  return {
    ok: true,
    productId,
    message: `Sale recorded. ${validation.value} unit${
      validation.value === 1 ? "" : "s"
    } sold. ${remaining} left in stock.`
  };
}
