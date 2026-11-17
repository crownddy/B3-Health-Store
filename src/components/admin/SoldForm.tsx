"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { recordSale, type SaleActionState } from "@/app/admin/(dashboard)/sold/actions";
import {
  SALE_PAGE_SIZE,
  clampPage,
  pageCount,
  validateSaleQuantity,
  type SellableProduct
} from "@/lib/products/sale";

const initialState: SaleActionState = { ok: false, message: "" };

type Props = {
  items: SellableProduct[];
  total: number;
  page: number;
  search: string;
  selected: SellableProduct | null;
};

/**
 * The Sold screen's interactive parts: search, pagination, product selection
 * and the sale form.
 *
 * Search, page and selection live in the URL, so results are shareable, the
 * back button works and the server renders the list. Selecting a product keeps
 * the current search and page, and the sale is submitted through the
 * recordSale server action (which reuses the atomic stock-out function).
 */
export default function SoldForm({ items, total, page, search, selected }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const [term, setTerm] = useState(search);
  const [quantity, setQuantity] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<SaleActionState, FormData>(
    recordSale,
    initialState
  );

  // After a sale lands, refresh the server data so the list and the available
  // quantity reflect the new stock, and clear the quantity box.
  useEffect(() => {
    if (state.ok) {
      setQuantity("");
      setClientError(null);
      router.refresh();
    }
  }, [state, router]);

  // Keep the box in step when the URL search changes (back button, clear).
  useEffect(() => {
    setTerm(search);
  }, [search]);

  function navigate(next: { q?: string; page?: number; product?: string | null }) {
    const merged = new URLSearchParams(params.toString());
    const q = next.q ?? search;
    const p = next.page ?? page;
    const product = next.product === undefined ? merged.get("product") : next.product;

    q.trim() ? merged.set("q", q.trim()) : merged.delete("q");
    p > 0 ? merged.set("page", String(p)) : merged.delete("page");
    product ? merged.set("product", product) : merged.delete("product");

    const query = merged.toString();
    router.push(query ? `/admin/sold?${query}` : "/admin/sold");
  }

  // Debounce typing so each keystroke does not trigger a navigation. Changing
  // the search resets to the first page and clears the selection.
  useEffect(() => {
    if (term === search) return;
    const timer = window.setTimeout(() => navigate({ q: term, page: 0, product: null }), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const pages = pageCount(total, SALE_PAGE_SIZE);
  const current = clampPage(page, total, SALE_PAGE_SIZE);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    if (!selected) return;
    const check = validateSaleQuantity(quantity, selected.quantity);
    if (!check.ok) {
      event.preventDefault();
      setClientError(check.message);
      return;
    }
    setClientError(null);
  }

  return (
    <>
      <div className="admin-filters">
        <div className="admin-filter-search">
          <input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search products by name"
            aria-label="Search products to sell"
          />
        </div>
        {search && (
          <button
            type="button"
            className="admin-button-small"
            onClick={() => {
              setTerm("");
              navigate({ q: "", page: 0, product: null });
            }}
          >
            Clear search
          </button>
        )}
      </div>

      {selected && (
        <div className="admin-sale-panel" aria-live="polite">
          <div>
            <span className="admin-sale-panel-label">Selected product</span>
            <strong className="admin-sale-panel-name">{selected.name}</strong>
            <small className="admin-sale-panel-stock">
              {selected.quantity} unit{selected.quantity === 1 ? "" : "s"} available to sell
            </small>
          </div>

          <form action={formAction} onSubmit={submit} className="admin-sale-form" noValidate>
            <input type="hidden" name="product_id" value={selected.id} />
            <input type="hidden" name="available" value={selected.quantity} />

            <label className="admin-field">
              <span>Quantity sold</span>
              <input
                type="number"
                name="quantity"
                min={1}
                max={selected.quantity}
                step={1}
                inputMode="numeric"
                value={quantity}
                onChange={(event) => {
                  setQuantity(event.target.value);
                  setClientError(null);
                }}
                placeholder="e.g. 1"
                required
                disabled={pending}
              />
            </label>

            <button type="submit" className="admin-button" disabled={pending}>
              {pending ? "Recording…" : "Confirm Sale"}
            </button>
          </form>
        </div>
      )}

      {(clientError || (state.message && !state.ok)) && (
        <p className="admin-alert admin-alert-error" role="alert">
          {clientError ?? state.message}
        </p>
      )}
      {state.ok && (
        <p className="admin-alert admin-alert-ok" role="status">
          {state.message}
        </p>
      )}

      {items.length === 0 ? (
        <div className="admin-empty">
          <strong>{search ? "No products match your search" : "No products available to sell"}</strong>
          <small>
            {search
              ? "Try a different product name."
              : "Products appear here once they are active and have stock that is not expired."}
          </small>
        </div>
      ) : (
        <>
          <ul className="admin-sale-list">
            {items.map((product) => {
              const isSelected = selected?.id === product.id;
              return (
                <li key={product.id}>
                  <button
                    type="button"
                    className={`admin-sale-item ${isSelected ? "admin-sale-item-active" : ""}`}
                    onClick={() => navigate({ product: product.id, page: current })}
                    aria-pressed={isSelected}
                    disabled={pending}
                  >
                    <span className="admin-sale-item-name">{product.name}</span>
                    <span className="admin-sale-item-qty">{product.quantity} available</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {pages > 1 && (
            <div className="admin-pager">
              <button
                type="button"
                className="admin-button-small"
                onClick={() => navigate({ page: current - 1, product: null })}
                disabled={current <= 0 || pending}
              >
                ← Previous
              </button>
              <span className="admin-pager-status">
                Page {current + 1} of {pages} · {total} product{total === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="admin-button-small"
                onClick={() => navigate({ page: current + 1, product: null })}
                disabled={current >= pages - 1 || pending}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
