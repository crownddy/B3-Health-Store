"use client";

import { useActionState, useState } from "react";
import { recordStockMovement, type StockActionState } from "@/app/admin/(dashboard)/stock/actions";

type Option = { id: string; name: string; quantity: number };

const initialState: StockActionState = { ok: false, message: "" };

export default function StockMovementForm({ products }: { products: Option[] }) {
  const [state, formAction, pending] = useActionState(recordStockMovement, initialState);
  const [movementType, setMovementType] = useState("stock_in");

  return (
    <form action={formAction} className="admin-form">
      {state.message && (
        <p
          className={`admin-alert ${state.ok ? "admin-alert-ok" : "admin-alert-error"}`}
          role="status"
        >
          {state.message}
        </p>
      )}

      <div className="admin-form-row">
        <label className="admin-field">
          <span>Product</span>
          <select name="product_id" required defaultValue="" disabled={pending}>
            <option value="" disabled>
              Select a product
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} · {product.quantity} in stock
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>Movement type</span>
          <select
            name="movement_type"
            required
            value={movementType}
            onChange={(event) => setMovementType(event.target.value)}
            disabled={pending}
          >
            <option value="stock_in">Stock in</option>
            <option value="stock_out">Stock out (FEFO)</option>
            <option value="adjustment">Adjustment (set exact quantity)</option>
          </select>
        </label>
      </div>

      {movementType === "stock_in" && (
        <div className="admin-form-row">
          <label className="admin-field">
            <span>Expiration date</span>
            <input type="date" name="expiration_date" disabled={pending} />
            <small className="admin-field-hint">
              Each receipt keeps its own expiry. Leave blank if the batch has no expiry date.
            </small>
          </label>

          <label className="admin-field">
            <span>Batch number (optional)</span>
            <input
              type="text"
              name="batch_number"
              maxLength={80}
              placeholder="Generated automatically if left blank"
              disabled={pending}
            />
            <small className="admin-field-hint">
              Receiving the same batch number with the same expiry tops up that batch.
            </small>
          </label>
        </div>
      )}

      {movementType === "stock_out" && (
        <p className="admin-note" role="status">
          Stock out follows FEFO: units are taken from the batch expiring soonest first, spanning
          several batches when needed. Expired batches are never sold.
        </p>
      )}

      <div className="admin-form-row">
        <label className="admin-field">
          <span>Quantity</span>
          <input
            type="number"
            name="quantity"
            min={1}
            step={1}
            inputMode="numeric"
            placeholder="e.g. 24"
            required
            disabled={pending}
          />
        </label>

        <label className="admin-field">
          <span>Note (optional)</span>
          <input
            type="text"
            name="note"
            maxLength={200}
            placeholder="Supplier delivery, damaged stock…"
            disabled={pending}
          />
        </label>
      </div>

      <button type="submit" className="admin-button" disabled={pending || products.length === 0}>
        {pending ? "Recording…" : "Record movement"}
      </button>
    </form>
  );
}
