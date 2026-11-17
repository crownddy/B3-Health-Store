import type { CatalogQuery, ProductRecord } from "@/lib/products/types";

/**
 * Filters a loaded catalogue in memory.
 *
 * Kept pure so the search, category and status rules can be unit tested
 * without a database. The catalogue is small enough (a single store) that
 * filtering here is simpler and safer than building PostgREST `or` filters.
 */
export function filterProducts(products: ProductRecord[], query: CatalogQuery): ProductRecord[] {
  const term = (query.search ?? "").trim().toLowerCase();
  const category = (query.category ?? "").trim();
  const status = query.status ?? "all";

  return products.filter((product) => {
    if (status !== "all" && product.status !== status) return false;

    if (category && category !== "all") {
      if ((product.category ?? "").toLowerCase() !== category.toLowerCase()) return false;
    }

    if (term) {
      const haystack = [product.name, product.category]
        .map((value) => (value ?? "").toLowerCase())
        .join(" ");
      if (!haystack.includes(term)) return false;
    }

    return true;
  });
}

/** Distinct, alphabetically sorted category names present in the catalogue. */
export function collectCategories(products: ProductRecord[]): string[] {
  const seen = new Set<string>();
  for (const product of products) {
    const name = (product.category ?? "").trim();
    if (name) seen.add(name);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}
