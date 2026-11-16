import { requireAdmin } from "@/lib/auth";
import { getCategories, getProducts } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, money } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminProductsPage() {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const [products, categories] = await Promise.all([getProducts(), getCategories()]);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">CATALOGUE</p>
          <h1>Products</h1>
          <p className="admin-page-sub">
            {products.length} product{products.length === 1 ? "" : "s"} ·{" "}
            {categories.length} categor{categories.length === 1 ? "y" : "ies"}
          </p>
        </div>
      </div>

      <SectionCard
        title="Product catalogue"
        description="Read-only view. Publishing and editing require Super Admin."
      >
        {products.length === 0 ? (
          <EmptyState
            title="No products yet"
            hint="Add products in Supabase, then publish them to the homepage."
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
                  <th>Shelf</th>
                  <th>Homepage</th>
                  <th>Featured</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.category ?? "—"}</td>
                    <td>{product.sku ?? "—"}</td>
                    <td className="admin-num">{money(product.purchase_price)}</td>
                    <td className="admin-num">{money(product.selling_price)}</td>
                    <td className="admin-num">{product.quantity}</td>
                    <td>{product.shelf_number ?? "—"}</td>
                    <td>
                      <StatusPill tone={product.is_visible_on_homepage ? "good" : "muted"}>
                        {product.is_visible_on_homepage ? "Published" : "Hidden"}
                      </StatusPill>
                    </td>
                    <td>
                      <StatusPill tone={product.is_featured ? "good" : "muted"}>
                        {product.is_featured ? "Yes" : "No"}
                      </StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {!isSuperAdmin && (
        <p className="admin-note">
          You are signed in as Staff. Creating, editing and deleting products is reserved for
          Super Admins.
        </p>
      )}
    </>
  );
}
