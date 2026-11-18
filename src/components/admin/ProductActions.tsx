"use client";

import { useActionState } from "react";
import { archiveProduct, deleteProduct } from "@/app/admin/(dashboard)/products/actions";
import { EMPTY_PRODUCT_STATE, type ProductActionState } from "@/lib/products/action-state";
import type { ProductStatus } from "@/lib/products/types";

export default function ProductActions({
  id,
  status
}: {
  id: string;
  status: ProductStatus;
}) {
  const [archiveState, archiveAction, archivePending] = useActionState<ProductActionState, FormData>(
    archiveProduct,
    EMPTY_PRODUCT_STATE
  );
  const [deleteState, deleteAction, deletePending] = useActionState<ProductActionState, FormData>(
    deleteProduct,
    EMPTY_PRODUCT_STATE
  );

  const archived = status === "archived";

  return (
    <div className="admin-product-actions">
      <form
        action={archiveAction}
        className="admin-inline-form"
        onSubmit={(event) => {
          const message = archived
            ? "Restore this product to the active catalogue?"
            : "Archive this product? It will be hidden from the storefront. Stock history is kept.";
          if (!window.confirm(message)) event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        {archived && <input type="hidden" name="restore" value="1" />}
        <button type="submit" className="admin-button-small" disabled={archivePending}>
          {archivePending ? "Working…" : archived ? "Restore product" : "Archive product"}
        </button>
        {archiveState.message && (
          <span className={archiveState.ok ? "admin-inline-ok" : "admin-inline-error"} role="status">
            {archiveState.message}
          </span>
        )}
      </form>

      <form
        action={deleteAction}
        className="admin-inline-form"
        onSubmit={(event) => {
          if (
            !window.confirm(
              "Are you sure you want to delete this product? It will be removed from the catalogue. Any batch and stock-movement history is kept."
            )
          ) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="admin-button-small admin-button-danger" disabled={deletePending}>
          {deletePending ? "Deleting…" : "Delete product"}
        </button>
        {deleteState.message && (
          <span className={deleteState.ok ? "admin-inline-ok" : "admin-inline-error"} role="status">
            {deleteState.message}
          </span>
        )}
      </form>
    </div>
  );
}
