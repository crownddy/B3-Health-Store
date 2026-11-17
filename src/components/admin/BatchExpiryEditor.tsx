"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updateBatchExpiration } from "@/app/admin/(dashboard)/inventory/actions";
import {
  EMPTY_INVENTORY_STATE,
  type InventoryActionState
} from "@/lib/products/inventory-action-state";

type Props = {
  batchId: string;
  productId: string;
  expirationDate: string | null;
};

/**
 * Lets a Super Admin set or clear one batch's expiration date.
 *
 * Only the expiration date is submitted; the server action writes only that
 * column, so editing an expiry never changes quantities or movement history.
 * Rendered only for Super Admins — the action re-checks the role and the batch
 * RLS policy enforces it again.
 */
export default function BatchExpiryEditor({ batchId, productId, expirationDate }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<InventoryActionState, FormData>(
    updateBatchExpiration,
    EMPTY_INVENTORY_STATE
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="admin-expiry-editor">
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="product_id" value={productId} />
      <label className="admin-field">
        <span className="admin-expiry-editor-label">Set expiry</span>
        <input
          type="date"
          name="expiration_date"
          defaultValue={expirationDate ?? ""}
          disabled={pending}
          aria-label="Batch expiration date"
        />
      </label>
      <button type="submit" className="admin-button-small" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state.message && (
        <small className={state.ok ? "admin-inline-ok" : "admin-inline-error"} role="status">
          {state.message}
        </small>
      )}
    </form>
  );
}
