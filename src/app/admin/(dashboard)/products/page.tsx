import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getProducts } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, money } from "@/components/admin/ui";
import ProductFilters from "@/components/admin/ProductFilters";
import { filterProducts, collectCategories } from "@/lib/products/query";
import { stockStatus } from "@/lib/products/stock";
import type { ProductStatus } from "@/lib/products/types";

export const dynamic = "force-dynamic";

function readStatus(value: string | string[] | undefined): ProductStatus | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "active" || raw === "archived" ? raw : "all";
}

function readString(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ?? "";
}

export default async function AdminProductsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const params = await searchParams;

  const products = await getProducts();
  const categories = collectCategories(products);

  const search = readString(params.q);
  const status = readStatus(params.status);
  const category = readString(params.category) || "all";

  const filtered = filterProducts(products, { search, category, status });
  const activeCount = products.filter((product) => product.status === "active").length;
  const archivedCount = products.length - activeCount;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">CATALOGUE</p>
          <h1>Products</h1>
          <p className="admin-page-sub">
            {products.length} product{products.length === 1 ? "" : "s"} · {activeCount} active ·{" "}
            {archivedCount} archived
          </p>
        </div>
        {isSuperAdmin && (
          <Link href="/admin/products/new" className="admin-button admin-button-inline">
            + Add product
          </Link>
        )}
      </div>

      {params.created && (
        <p className="admin-alert admin-alert-ok" role="status">
          Product created. Use Stock In to add opening stock — product editing never changes stock
          levels.
        </p>
      )}
      {params.deleted && (
        <p className="admin-alert admin-alert-ok" role="status">
          Product deleted.
        </p>
      )}
      {params.archived && (
        <p className="admin-alert admin-alert-ok" role="status">
          Product archived.
        </p>
      )}

      <SectionCard
        title="Product catalogue"
        description={
          isSuperAdmin
            ? "Search, filter and manage products. Stock levels change only through Stock In / Out."
            : "Read-only view. Creating, editing and archiving products requires Super Admin."
        }
      >
        <ProductFilters categories={categories} />

        {filtered.length === 0 ? (
          <EmptyState
            title={products.length === 0 ? "No products yet" : "No products match your filters"}
            hint={
              products.length === 0
                ? "Add your first product to build the catalogue."
                : "Try a different search term, category or status."
            }
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Category</th>
                  <th>SKU</th>
                  <th className="admin-num">Buy</th>
                  <th className="admin-num">Sell</th>
                  <th className="admin-num">Qty</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((product) => {
                  const stock = stockStatus(product.quantity, product.minimum_stock);
                  return (
                    <tr key={product.id}>
                      <td>
                        <Link href={`/admin/products/${product.id}`} className="admin-table-link">
                          {product.name}
                        </Link>
                        {product.is_visible_on_homepage && (
                          <small className="admin-table-tag">Homepage</small>
                        )}
                      </td>
                      <td>{product.category ?? "—"}</td>
                      <td className="admin-mono">{product.sku ?? "—"}</td>
                      <td className="admin-num">{money(product.purchase_price)}</td>
                      <td className="admin-num">{money(product.selling_price)}</td>
                      <td className="admin-num">{product.quantity}</td>
                      <td>
                        <StatusPill tone={stock.tone}>{stock.label}</StatusPill>
                      </td>
                      <td>
                        <StatusPill tone={product.status === "active" ? "good" : "muted"}>
                          {product.status === "active" ? "Active" : "Archived"}
                        </StatusPill>
                      </td>
                      <td>
                        <Link href={`/admin/products/${product.id}`} className="admin-button-small">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {!isSuperAdmin && (
        <p className="admin-note">
          You are signed in as Staff. Creating, editing and archiving products is reserved for Super
          Admins.
        </p>
      )}
    </>
  );
}
