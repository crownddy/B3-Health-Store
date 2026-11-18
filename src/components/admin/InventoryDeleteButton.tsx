"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  archiveInventoryProduct,
  deleteInventoryProduct
} from "@/app/admin/(dashboard)/inventory/actions";
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState
} from "@/lib/products/inventory-action-state";

type Props = {
  id: string;
  name: string;
  status: string;
};

/**
 * Delete (and archive) controls for one product in the Inventory list.
 *
 * Deletion always goes through a confirmation dialog that names the product.
 * If the product has batches or stock movements the server refuses and returns
 * a `blocked` result, and this shows the reason and offers archiving instead —
 * history is never deleted to force a delete through. The controls are only
 * rendered for Super Admins (the server action re-checks the role, and RLS
 * enforces it a third time).
 */
export default function InventoryDeleteButton({ id, name, status }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const [deleteState, deleteAction, deletePending] = useActionState<
    InventoryActionState,
    FormData
  >(deleteInventoryProduct, EMPTY_INVENTORY_STATE);
  const [archiveState, archiveAction, archivePending] = useActionState<
    InventoryActionState,
    FormData
  >(archiveInventoryProduct, EMPTY_INVENTORY_STATE);

  // Once a delete is refused for history, keep the dialog open so the archive
  // fallback is offered. A successful archive closes it and refreshes the list.
  useEffect(() => {
    if (archiveState.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [archiveState, router]);

  const archived = status === "archived";
  const blocked = deleteState.blocked === true;

  return (
    <>
      <button
        type="button"
        className="admin-button-small admin-button-danger"
        onClick={() => {
          setConfirmText("");
          setOpen(true);
        }}
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
              You are about to permanently delete <strong>{name}</strong>. This cannot be undone.
            </p>
            <p className="admin-modal-copy">
              Type the product name to confirm.
            </p>
            <input
              type="text"
              className="admin-modal-input"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={name}
              aria-label="Type the product name to confirm deletion"
            />

            {deleteState.message && !deleteState.ok && (
              <p className="admin-alert admin-alert-error" role="alert">
                {deleteState.message}
              </p>
            )}
            {blocked && (
              <p className="admin-note">
                Archiving keeps the product&apos;s batch and stock-movement history while taking it
                out of the catalogue. This is the right choice for a discontinued product.
              </p>
            )}
            {archiveState.message && (
              <p
                className={`admin-alert ${archiveState.ok ? "admin-alert-ok" : "admin-alert-error"}`}
                role="status"
              >
                {archiveState.message}
              </p>
            )}

            <div className="admin-modal-actions">
              <button
                type="button"
                className="admin-button-small"
                onClick={() => setOpen(false)}
                disabled={deletePending || archivePending}
              >
                Cancel
              </button>

              {blocked && (
                <form action={archiveAction}>
                  <input type="hidden" name="id" value={id} />
                  {archived && <input type="hidden" name="restore" value="1" />}
                  <button
                    type="submit"
                    className="admin-button-small"
                    disabled={archivePending}
                  >
                    {archivePending ? "Working…" : archived ? "Restore product" : "Archive product"}
                  </button>
                </form>
              )}

              {!blocked && (
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={id} />
                  <button
                    type="submit"
                    className="admin-button-small admin-button-danger"
                    disabled={deletePending || confirmText.trim() !== name}
                  >
                    {deletePending ? "Deleting…" : "Delete permanently"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
