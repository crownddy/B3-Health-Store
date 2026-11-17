"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Search and filter controls for the catalogue.
 *
 * State lives in the URL so the results are shareable, the browser back button
 * works, and the server can render the filtered list.
 */
export default function ProductFilters({ categories }: { categories: string[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const [search, setSearch] = useState(params.get("q") ?? "");
  const status = params.get("status") ?? "all";
  const category = params.get("category") ?? "all";

  function apply(next: { q?: string; status?: string; category?: string }) {
    const merged = new URLSearchParams(params.toString());
    const q = next.q ?? search;
    const s = next.status ?? status;
    const c = next.category ?? category;

    q.trim() ? merged.set("q", q.trim()) : merged.delete("q");
    s !== "all" ? merged.set("status", s) : merged.delete("status");
    c !== "all" ? merged.set("category", c) : merged.delete("category");

    const query = merged.toString();
    router.push(query ? `/admin/products?${query}` : "/admin/products");
  }

  // Debounce typing so each keystroke does not trigger a navigation.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (search === current) return;
    const timer = window.setTimeout(() => apply({ q: search }), 350);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const active = search.trim() !== "" || status !== "all" || category !== "all";

  return (
    <div className="admin-filters">
      <div className="admin-filter-search">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, SKU or barcode"
          aria-label="Search products"
        />
      </div>

      <label className="admin-field admin-filter-field">
        <span>Status</span>
        <select value={status} onChange={(event) => apply({ status: event.target.value })}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </label>

      <label className="admin-field admin-filter-field">
        <span>Category</span>
        <select value={category} onChange={(event) => apply({ category: event.target.value })}>
          <option value="all">All categories</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>

      {active && (
        <button
          type="button"
          className="admin-button-small"
          onClick={() => {
            setSearch("");
            router.push("/admin/products");
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
