"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getProductReferenceCounts, getProducts } from "@/lib/data";
import { validateProductInput, validateInitialStock, firstError } from "@/lib/products/validation";
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
    "initial_quantity",
    "initial_expiration_date",
    "initial_batch_number",
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
  const initial = validateInitialStock(formData);
  if (!result.ok || !initial.ok) {
    const errors = {
      ...(result.ok ? {} : result.errors),
      ...(initial.ok ? {} : initial.errors)
    };
    return {
      ok: false,
      message: firstError(errors),
      errors,
      values: collectFormValues(formData)
    };
  }

  const opening = initial.value;
  const supabase = await createClient();
  // The product, its opening batch, the matching stock-in movement and the
  // total quantity are written by one function in a single transaction. Either
  // all of them are created or none are, so a product can never be left with a
  // batch but no movement (or a total that disagrees with its batches).
  const { data, error } = await supabase.rpc("create_product_with_initial_stock", {
    p_name: result.value.name,
    p_description: result.value.description,
    p_category: result.value.category,
    p_sku: result.value.sku,
    p_barcode: result.value.barcode,
    p_image_url: result.value.image_url,
    p_purchase_price: result.value.purchase_price,
    p_selling_price: result.value.selling_price,
    p_minimum_stock: result.value.minimum_stock,
    p_shelf_number: result.value.shelf_number,
    p_is_visible_on_homepage: result.value.is_visible_on_homepage,
    p_is_featured: result.value.is_featured,
    p_initial_quantity: opening?.quantity ?? 0,
    p_initial_expiration_date: opening?.expiration_date ?? null,
    p_initial_batch_number: opening?.batch_number ?? null
  });

  if (error) return { ok: false, message: describeWriteError(error) };

  const productId = (data as { product_id?: string } | null)?.product_id ?? "";

  revalidatePath("/admin/products");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/stock");
  revalidatePath("/admin/expiry");
  revalidatePath("/admin");
  revalidatePath("/");

  redirect(`/admin/products/${productId}?created=1`);
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
