import type { SupabaseClient } from "@supabase/supabase-js";
import { planProductDeletion, type ProductReferences } from "./policy.ts";

export type DeleteOutcome =
  | { ok: true; mode: "hard" | "soft"; message: string }
  | { ok: false; message: string };

/**
 * Removes a product from the active catalogue, preserving history.
 *
 * - No batches and no stock movements: the row is hard deleted (nothing to
 *   preserve). If a foreign key still blocks the delete (a record created
 *   between the count and the delete), it falls back to a soft delete rather
 *   than failing.
 * - Batches or stock movements: the product is soft deleted — `deleted_at` is
 *   set, `status` becomes 'archived' and it is hidden from the storefront. The
 *   batch and movement rows are left exactly as they are.
 *
 * Authorization is enforced by the caller (`requireSuperAdmin`) and again by Row
 * Level Security on the write itself. Every write is chained with `.select()` so
 * a policy that filters the row out (rather than erroring) is detected as "no
 * rows changed" instead of a false success.
 */
export async function deleteProductSafely(
  supabase: SupabaseClient,
  productId: string,
  references: ProductReferences
): Promise<DeleteOutcome> {
  const plan = planProductDeletion(references);
  // The message for the soft-delete path. A hard-delete attempt can still fall
  // through to it (a history row created between the count and the delete), so
  // it is computed once and reused.
  const softMessage =
    plan.mode === "soft"
      ? plan.reason
      : "This product is referenced by other records. It was removed from the catalogue and its history is kept.";

  if (plan.mode === "hard") {
    const { data, error } = await supabase
      .from("products")
      .delete()
      .eq("id", productId)
      .select("id");

    if (!error) {
      if ((data ?? []).length > 0) return { ok: true, mode: "hard", message: "Product deleted." };
      return { ok: false, message: "That product could not be found." };
    }

    // 23503: a foreign key still references the row. Fall through to soft delete
    // instead of failing. Any other error is surfaced.
    if (error.code !== "23503") return { ok: false, message: error.message };
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      deleted_at: new Date().toISOString(),
      status: "archived",
      is_visible_on_homepage: false
    })
    .eq("id", productId)
    .select("id");

  if (error) return { ok: false, message: error.message };
  if ((data ?? []).length === 0) {
    return { ok: false, message: "That product could not be found." };
  }

  return { ok: true, mode: "soft", message: softMessage };
}
