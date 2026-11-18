"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { EXPIRING_SOON_LABEL } from "@/lib/products/batches";

/**
 * Search, expiration filter and pagination for the Inventory list.
 *
 * All state lives in the URL, so results are shareable, the back button works
 * and the server renders the filtered page. Typing is debounced; a new search
 * or filter always resets to the first page, and the pager never points past
 * the end.
 */
export default function InventoryFilters({
  total,
  page,
  pages
}: {
  total: number;
  page: number;
  pages: number;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [term, setTerm] = useState(params.get("q") ?? "");
  const expiry = params.get("expiry") ?? "all";

  // Keep the box in step when the URL changes (back button, clear, filter).
  useEffect(() => {
    setTerm(params.get("q") ?? "");
  }, [params]);

  function navigate(next: { q?: string; expiry?: string; page?: number }) {
    const merged = new URLSearchParams(params.toString());
    const q = next.q ?? term;
    const e = next.expiry ?? expiry;
    const p = next.page ?? page;

    q.trim() ? merged.set("q", q.trim()) : merged.delete("q");
    e !== "all" ? merged.set("expiry", e) : merged.delete("expiry");
    // Any change to the search or filter starts again from the first page.
    p > 0 ? merged.set("page", String(p)) : merged.delete("page");

    const query = merged.toString();
    router.push(query ? `/admin/inventory?${query}` : "/admin/inventory");
  }

  // Debounce typing so each keystroke does not trigger a navigation.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (term === current) return;
    const timer = window.setTimeout(() => navigate({ q: term, page: 0 }), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const filtered = term.trim() !== "" || expiry !== "all";

  return (
    <div className="admin-filters">
      <div className="admin-filter-search">
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search products by name"
          aria-label="Search inventory by product name"
        />
      </div>

      <label className="admin-field admin-filter-field">
        <span>Expiration status</span>
        <select
          value={expiry}
          onChange={(event) => navigate({ expiry: event.target.value, page: 0 })}
        >
          <option value="all">All products</option>
          <option value="expired">Expired</option>
          <option value="expiring_soon">Expiring soon (≤ {EXPIRING_SOON_LABEL})</option>
          <option value="valid">Valid</option>
          <option value="no_date">No expiry date</option>
        </select>
      </label>

      {filtered && (
        <button
          type="button"
          className="admin-button-small"
          onClick={() => {
            setTerm("");
            router.push("/admin/inventory");
          }}
        >
          Clear filters
        </button>
      )}

      {pages > 1 && (
        <div className="admin-pager admin-pager-inline">
          <button
            type="button"
            className="admin-button-small"
            onClick={() => navigate({ page: page - 1 })}
            disabled={page <= 0}
          >
            ← Previous
          </button>
          <span className="admin-pager-status">
            Page {page + 1} of {pages} · {total} product{total === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="admin-button-small"
            onClick={() => navigate({ page: page + 1 })}
            disabled={page >= pages - 1}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
