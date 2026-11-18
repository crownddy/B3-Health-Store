"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteInventoryProduct } from "@/app/admin/(dashboard)/inventory/actions";
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState
} from "@/lib/products/inventory-action-state";

type Props = {
  id: string;
  name: string;
};

/**
 * Delete control for one product in the Inventory list.
 *
 * Deleting always asks for a simple confirmation, then removes the product from
 * the catalogue regardless of its current stock or movement history: a product
 * with no history is deleted outright, and one with history is removed from the
 * active list while its history is preserved. Nothing is ever blocked. The
 * controls are only rendered for Super Admins (the server action re-checks the
 * role, and RLS enforces it a third time).
 */
export default function InventoryDeleteButton({ id, name }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const [deleteState, deleteAction, deletePending] = useActionState<
    InventoryActionState,
    FormData
  >(deleteInventoryProduct, EMPTY_INVENTORY_STATE);

  // A failed delete (for example the product was already removed in another tab)
  // keeps the dialog open and shows the reason.
  useEffect(() => {
    if (deleteState.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [deleteState, router]);

  return (
    <>
      <button
        type="button"
        className="admin-button-small admin-button-danger"
        onClick={() => setOpen(true)}
      >
        Delete
      </button>

      {open && (
        <div
          className="admin-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={`Delete ${name}`}
        >
          <div className="admin-modal">
            <h2 className="admin-modal-title">Delete product</h2>
            <p className="admin-modal-copy">
              Are you sure you want to delete <strong>{name}</strong>? It will be removed from the
              catalogue. Any batch and stock-movement history is kept.
            </p>

            {deleteState.message && !deleteState.ok && (
              <p className="admin-alert admin-alert-error" role="alert">
                {deleteState.message}
              </p>
            )}

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-button-small"
                onClick={() => setOpen(false)}
                disabled={deletePending}
              >
                Cancel
              </button>

              <form action={deleteAction}>
                <input type="hidden" name="id" value={id} />
                <button
                  type="submit"
                  className="admin-button-small admin-button-danger"
                  disabled={deletePending}
                >
                  {deletePending ? "Deleting…" : "Delete"}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
