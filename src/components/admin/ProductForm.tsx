"use client";

import { useActionState, useRef, useState } from "react";
import Image from "next/image";
import { createProduct, updateProduct } from "@/app/admin/(dashboard)/products/actions";
import { EMPTY_PRODUCT_STATE, type ProductActionState } from "@/lib/products/action-state";
import { uploadProductImage } from "@/lib/products/image";
import type { ProductRecord } from "@/lib/products/types";

type Props = {
  mode: "create" | "edit";
  product?: ProductRecord;
  categories: string[];
};

/** Text-ish product fields the form can re-populate after a validation error. */
type TextField =
  | "name"
  | "category"
  | "description"
  | "selling_price"
  | "shelf_number"
  | "image_url";

/** Opening-stock fields, which only exist on the create form. */
type InitialStockField = "initial_quantity" | "initial_expiration_date" | "initial_batch_number";

type CheckboxField = "is_visible_on_homepage" | "is_featured";

export default function ProductForm({ mode, product, categories }: Props) {
  const action = mode === "create" ? createProduct : updateProduct;
  const [state, formAction, pending] = useActionState<ProductActionState, FormData>(
    action,
    EMPTY_PRODUCT_STATE
  );

  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = pending || uploading;
  const errors = state.errors ?? {};
  // React resets uncontrolled fields after an action, so re-populate from the
  // values the server echoed back when validation failed.
  const echo = state.values;
  const text = (field: TextField) => {
    const echoed = echo?.[field];
    if (echoed !== undefined) return echoed;
    const current = product?.[field];
    return current === null || current === undefined ? "" : String(current);
  };
  const initialStock = (field: InitialStockField) => echo?.[field] ?? "";
  const checked = (field: CheckboxField) =>
    echo ? echo[field] === "on" : (product?.[field] ?? false);
  // Remount the form when the server echoes values back. React clears
  // uncontrolled fields after a server action; remounting lets defaultValue
  // and defaultChecked reapply so the user's input survives a validation error.
  const formKey = echo ? JSON.stringify(echo) : "initial";

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    const result = await uploadProductImage(file);
    setUploading(false);
    if (!result.ok) {
      setUploadError(result.message);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setImageUrl(result.url);
  }

  return (
    <form key={formKey} action={formAction} className="admin-form">
      {mode === "edit" && product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="image_url" value={imageUrl} />

      {state.message && (
        <p
          className={`admin-alert ${state.ok ? "admin-alert-ok" : "admin-alert-error"}`}
          role="alert"
        >
          {state.message}
        </p>
      )}

      <div className="admin-form-row">
        <label className="admin-field">
          <span>Name</span>
          <input
            type="text"
            name="name"
            defaultValue={text("name")}
            maxLength={160}
            placeholder="e.g. Vitamin C 1000mg"
            required
            disabled={busy}
          />
          {errors.name && <small className="admin-field-error">{errors.name}</small>}
        </label>

        <label className="admin-field">
          <span>Category</span>
          <input
            type="text"
            name="category"
            list="product-categories"
            defaultValue={text("category")}
            maxLength={80}
            placeholder="e.g. Vitamins"
            disabled={busy}
          />
          <datalist id="product-categories">
            {categories.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {errors.category && <small className="admin-field-error">{errors.category}</small>}
        </label>
      </div>

      <label className="admin-field">
        <span>Description</span>
        <textarea
          name="description"
          defaultValue={text("description")}
          maxLength={2000}
          rows={3}
          placeholder="Short description shown to shoppers."
          disabled={busy}
        />
        {errors.description && <small className="admin-field-error">{errors.description}</small>}
      </label>

      <div className="admin-form-row">
        <label className="admin-field">
          <span>Selling price (₦)</span>
          <input
            type="number"
            name="selling_price"
            defaultValue={text("selling_price")}
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            disabled={busy}
          />
          {errors.selling_price && <small className="admin-field-error">{errors.selling_price}</small>}
        </label>

        <label className="admin-field">
          <span>Shelf number</span>
          <input
            type="text"
            name="shelf_number"
            defaultValue={text("shelf_number")}
            maxLength={40}
            placeholder="e.g. A1"
            disabled={busy}
          />
          {errors.shelf_number && <small className="admin-field-error">{errors.shelf_number}</small>}
        </label>
      </div>

      <div className="admin-field">
        <span>Product image</span>
        <div className="admin-image-upload">
          <div className="admin-image-preview">
            {imageUrl ? (
              <Image src={imageUrl} alt="Product image preview" width={96} height={96} unoptimized />
            ) : (
              <span aria-hidden="true">B3</span>
            )}
          </div>
          <div className="admin-image-controls">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleFile}
              disabled={busy}
            />
            {uploading && <small className="admin-inline-ok">Uploading…</small>}
            {uploadError && <small className="admin-field-error">{uploadError}</small>}
            {imageUrl && !uploading && (
              <button
                type="button"
                className="admin-button-small"
                onClick={() => {
                  setImageUrl("");
                  if (fileRef.current) fileRef.current.value = "";
                }}
                disabled={busy}
              >
                Remove image
              </button>
            )}
            <small className="admin-field-hint">JPEG, PNG, WebP or GIF · up to 5 MB.</small>
          </div>
        </div>
      </div>

      {mode === "create" && (
        <fieldset className="admin-fieldset" disabled={busy}>
          <legend>Initial stock (optional)</legend>
          <p className="admin-field-hint">
            Leave the quantity blank to create the product with no stock. Any quantity is saved as
            the first batch, with its own expiration date.
          </p>
          <div className="admin-form-row">
            <label className="admin-field">
              <span>Initial quantity</span>
              <input
                type="number"
                name="initial_quantity"
                defaultValue={initialStock("initial_quantity")}
                min={1}
                step={1}
                inputMode="numeric"
                placeholder="e.g. 24"
              />
              {errors.initial_quantity && (
                <small className="admin-field-error">{errors.initial_quantity}</small>
              )}
            </label>

            <label className="admin-field">
              <span>Expiration date</span>
              <input
                type="date"
                name="initial_expiration_date"
                defaultValue={initialStock("initial_expiration_date")}
              />
              {errors.initial_expiration_date && (
                <small className="admin-field-error">{errors.initial_expiration_date}</small>
              )}
            </label>
          </div>

          <label className="admin-field">
            <span>Batch number (optional)</span>
            <input
              type="text"
              name="initial_batch_number"
              defaultValue={initialStock("initial_batch_number")}
              maxLength={80}
              placeholder="Generated automatically if left blank"
            />
            {errors.initial_batch_number && (
              <small className="admin-field-error">{errors.initial_batch_number}</small>
            )}
          </label>
        </fieldset>
      )}

      <fieldset className="admin-fieldset" disabled={busy}>
        <legend>Visibility</legend>
        <label className="admin-check">
          <input
            type="checkbox"
            name="is_visible_on_homepage"
            defaultChecked={checked("is_visible_on_homepage")}
          />
          <span>Publish on the storefront homepage</span>
        </label>
        <label className="admin-check">
          <input type="checkbox" name="is_featured" defaultChecked={checked("is_featured")} />
          <span>Feature this product</span>
        </label>
      </fieldset>

      <div className="admin-form-actions">
        <button type="submit" className="admin-button" disabled={busy}>
          {busy
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create product"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}
