"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getProductReferenceCounts } from "@/lib/data";
import { deleteProductSafely } from "@/lib/products/delete";
import { describeWriteError } from "@/lib/products/errors";
import { normalizeDateString } from "@/lib/products/batches";
import type { InventoryActionState } from "@/lib/products/inventory-action-state";

function refreshPaths(productId?: string): void {
  revalidatePath("/admin");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/products");
  revalidatePath("/admin/expiry");
  if (productId) {
    revalidatePath(`/admin/inventory/${productId}`);
    revalidatePath(`/admin/products/${productId}`);
  }
}

/**
 * Removes a product from the Inventory list.
 *
 * Authorization is enforced twice, independently: requireSuperAdmin() checks the
 * signed-in role, and Row Level Security independently refuses the write for
 * anyone else, so a forged request cannot bypass either check. Staff never
 * reach this code path.
 *
 * Deletion always succeeds. A product with no history is hard deleted; a product
 * with batches or stock movements is soft deleted (hidden from every active
 * screen) so its history is preserved — never cascade-deleted.
 */
export async function deleteInventoryProduct(
  _prev: InventoryActionState | undefined,
  formData: FormData
): Promise<InventoryActionState> {
  await requireSuperAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "Missing product." };

  const references = await getProductReferenceCounts(id);
  const supabase = await createClient();
  const outcome = await deleteProductSafely(supabase, id, references);
  if (!outcome.ok) return { ok: false, message: outcome.message };

  refreshPaths(id);
  redirect("/admin/inventory?deleted=1");
}

/**
 * Sets or clears the expiration date of a single batch.
 *
 * Only the expiration date is written — the quantity received, quantity
 * remaining and every stock movement are left exactly as they were, so editing
 * an expiry never changes stock levels or history. Super Admin only, enforced
 * here and by the batch RLS policy.
 */
export async function updateBatchExpiration(
  _prev: InventoryActionState | undefined,
  formData: FormData
): Promise<InventoryActionState> {
  await requireSuperAdmin();

  const batchId = String(formData.get("batch_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  if (!batchId) return { ok: false, message: "Missing batch." };

  const raw = String(formData.get("expiration_date") ?? "").trim();
  const expirationDate = raw ? normalizeDateString(raw) : null;
  if (raw && !expirationDate) {
    return { ok: false, message: "Enter a valid expiration date." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("product_batches")
    .update({ expiration_date: expirationDate })
    .eq("id", batchId);

  if (error) return { ok: false, message: describeWriteError(error) };

  refreshPaths(productId || undefined);
  return {
    ok: true,
    message: expirationDate
      ? "Expiration date updated. Stock quantities were not changed."
      : "Expiration date cleared. Stock quantities were not changed."
  };
}
