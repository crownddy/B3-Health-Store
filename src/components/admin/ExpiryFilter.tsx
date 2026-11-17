"use client";

import { useRouter, useSearchParams } from "next/navigation";

/**
 * Filter for batch expiration status.
 *
 * State lives in the URL so results are shareable and the server renders the
 * filtered list. `basePath` is the page the filter belongs to (inventory or
 * expiry), so the same control works on both.
 */
export default function ExpiryFilter({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = params.get("expiry") ?? "all";

  function apply(value: string) {
    const merged = new URLSearchParams(params.toString());
    value !== "all" ? merged.set("expiry", value) : merged.delete("expiry");
    const query = merged.toString();
    router.push(query ? `${basePath}?${query}` : basePath);
  }

  return (
    <label className="admin-field admin-filter-field">
      <span>Expiration status</span>
      <select value={current} onChange={(event) => apply(event.target.value)}>
        <option value="all">All batches</option>
        <option value="expired">Expired</option>
        <option value="expiring_soon">Expiring soon (≤ 30 days)</option>
        <option value="valid">Valid</option>
        <option value="no_date">No expiry date</option>
      </select>
    </label>
  );
}
