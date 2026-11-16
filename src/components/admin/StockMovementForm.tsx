"use client";

import { useActionState } from "react";
import { recordStockMovement, type StockActionState } from "@/app/admin/(dashboard)/stock/actions";

type Option = { id: string; name: string; quantity: number };

const initialState: StockActionState = { ok: false, message: "" };

export default function StockMovementForm({ products }: { products: Option[] }) {
  const [state, formAction, pending] = useActionState(recordStockMovement, initialState);

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
          <select name="movement_type" required defaultValue="stock_in" disabled={pending}>
            <option value="stock_in">Stock in</option>
            <option value="stock_out">Stock out</option>
            <option value="adjustment">Adjustment (set exact quantity)</option>
          </select>
        </label>
      </div>

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
