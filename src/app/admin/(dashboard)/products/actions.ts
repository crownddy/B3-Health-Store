"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getProductReferenceCounts, getProducts } from "@/lib/data";
import { validateProductInput, firstError } from "@/lib/products/validation";
import { canDeleteProduct } from "@/lib/products/policy";
import { describeWriteError } from "@/lib/products/errors";
import type { ProductActionState } from "@/lib/products/action-state";

/**
 * Snapshot of the submitted descriptive fields, echoed back so a validation
 * error does not discard what the user typed. Only string fields are captured;
 * checkboxes are handled by the form's own defaults.
 */
function collectFormValues(formData: FormData): Record<string, string> {
  const fields = [
    "name",
    "category",
    "sku",
    "barcode",
    "description",
    "purchase_price",
    "selling_price",
    "minimum_stock",
    "shelf_number",
    "image_url",
    "is_visible_on_homepage",
    "is_featured"
  ];
  const values: Record<string, string> = {};
  for (const field of fields) {
    values[field] = String(formData.get(field) ?? "");
  }
  return values;
}

/**
 * Authorization is enforced here, on the server, for every product write:
 * `requireSuperAdmin()` reads the role from `profiles` for the current session
 * and redirects anyone who is not a super_admin. Supabase Row Level Security
 * enforces the same rule independently on the write itself, so a forged
 * request cannot bypass either check. Staff never gain write access.
 */

export async function createProduct(
  _prev: ProductActionState | undefined,
  formData: FormData
): Promise<ProductActionState> {
  await requireSuperAdmin();
  const existing = await getProducts();

  const result = validateProductInput(formData, existing, null);
  if (!result.ok) {
    return {
      ok: false,
      message: firstError(result.errors),
      errors: result.errors,
      values: collectFormValues(formData)
    };
  }

  const supabase = await createClient();
  // quantity is intentionally set to 0: stock is only ever changed through the
  // stock-movement workflow, never by creating or editing a product.
  const { data, error } = await supabase
    .from("products")
    .insert({ ...result.value, quantity: 0 })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, message: describeWriteError(error) };

  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
  revalidatePath("/");

  redirect(`/admin/products/${data?.id ?? ""}?created=1`);
}

export async function updateProduct(
  _prev: ProductActionState | undefined,
  formData: FormData
): Promise<ProductActionState> {
  await requireSuperAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "Missing product." };

  const existing = await getProducts();
  if (!existing.some((product) => product.id === id)) {
    return { ok: false, message: "That product no longer exists." };
  }

  const result = validateProductInput(formData, existing, id);
  if (!result.ok) {
    return {
      ok: false,
      message: firstError(result.errors),
      errors: result.errors,
      values: collectFormValues(formData)
    };
  }

  const supabase = await createClient();
  // Only descriptive fields are written. quantity is never touched here, so an
  // edit can never overwrite stock levels or the movement history behind them.
  const { error } = await supabase
    .from("products")
    .update({ ...result.value, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return { ok: false, message: describeWriteError(error) };

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
  revalidatePath("/");

  redirect(`/admin/products/${id}?updated=1`);
}

export async function archiveProduct(
  _prev: ProductActionState | undefined,
  formData: FormData
): Promise<ProductActionState> {
  await requireSuperAdmin();

  const id = String(formData.get("id") ?? "").trim();
  const restore = String(formData.get("restore") ?? "") === "1";
  if (!id) return { ok: false, message: "Missing product." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      status: restore ? "active" : "archived",
      // Archiving also hides the product from the storefront, so an archived
      // item can never be bought by mistake.
      ...(restore ? {} : { is_visible_on_homepage: false }),
      updated_at: new Date().toISOString()
    })
    .eq("id", id);

  if (error) return { ok: false, message: describeWriteError(error) };

  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/admin");
  revalidatePath("/");

  return {
    ok: true,
    message: restore ? "Product restored to the active catalogue." : "Product archived."
  };
}

export async function deleteProduct(
  _prev: ProductActionState | undefined,
  formData: FormData
): Promise<ProductActionState> {
  await requireSuperAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { ok: false, message: "Missing product." };

  // Refuse to delete anything with history. The database enforces this too
  // (stock_movements.product_id is on delete restrict), but checking first
  // gives the user a clear, actionable message instead of a raw error.
  const references = await getProductReferenceCounts(id);
  const decision = canDeleteProduct(references);
  if (!decision.allowed) return { ok: false, message: decision.reason };

  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false, message: describeWriteError(error) };

  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin");
  revalidatePath("/");

  redirect("/admin/products?deleted=1");
}
