import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getProduct, getProductBatches, getProductReferenceCounts } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, StatCard, money, formatDate, daysUntil } from "@/components/admin/ui";
import ProductActions from "@/components/admin/ProductActions";
import { stockStatus } from "@/lib/products/stock";
import { canDeleteProduct } from "@/lib/products/policy";

export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const { id } = await params;
  const query = await searchParams;

  const product = await getProduct(id);
  if (!product) notFound();

  const [batches, references] = await Promise.all([
    getProductBatches(id),
    getProductReferenceCounts(id)
  ]);

  const decision = canDeleteProduct(references);
  const stock = stockStatus(product.quantity, product.minimum_stock);
  const margin = Number(product.selling_price) - Number(product.purchase_price);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">PRODUCT</p>
          <h1>{product.name}</h1>
          <p className="admin-page-sub">
            {product.category ?? "Uncategorised"} · SKU {product.sku ?? "—"} ·{" "}
            <StatusPill tone={product.status === "active" ? "good" : "muted"}>
              {product.status === "active" ? "Active" : "Archived"}
            </StatusPill>
          </p>
        </div>
        <div className="admin-page-head-actions">
          <Link href="/admin/products" className="admin-link-quiet">
            ← Back
          </Link>
          {isSuperAdmin && (
            <Link href={`/admin/products/${product.id}/edit`} className="admin-button admin-button-inline">
              Edit product
            </Link>
          )}
        </div>
      </div>

      {query.created && (
        <p className="admin-alert admin-alert-ok" role="status">
          Product created.
        </p>
      )}
      {query.updated && (
        <p className="admin-alert admin-alert-ok" role="status">
          Product updated.
        </p>
      )}

      <div className="admin-stats">
        <StatCard label="On hand" value={String(product.quantity)} hint={stock.label} tone={stock.tone === "good" ? "good" : stock.tone === "warn" ? "warn" : "danger"} />
        <StatCard label="Reorder level" value={String(product.minimum_stock)} hint="Alert threshold" />
        <StatCard label="Selling price" value={money(product.selling_price)} hint="Per unit" />
        <StatCard
          label="Margin"
          value={money(margin)}
          tone={margin < 0 ? "danger" : "default"}
          hint="Selling − cost"
        />
      </div>

      <div className="admin-grid-2">
        <SectionCard title="Details" description="Descriptive information for this product.">
          <dl className="admin-detail-list">
            <div>
              <dt>Barcode</dt>
              <dd className="admin-mono">{product.barcode ?? "—"}</dd>
            </div>
            <div>
              <dt>Cost price</dt>
              <dd>{money(product.purchase_price)}</dd>
            </div>
            <div>
              <dt>Selling price</dt>
              <dd>{money(product.selling_price)}</dd>
            </div>
            <div>
              <dt>Shelf number</dt>
              <dd>{product.shelf_number ?? "—"}</dd>
            </div>
            <div>
              <dt>Storefront</dt>
              <dd>
                <StatusPill tone={product.is_visible_on_homepage ? "good" : "muted"}>
                  {product.is_visible_on_homepage ? "Published" : "Hidden"}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt>Featured</dt>
              <dd>
                <StatusPill tone={product.is_featured ? "good" : "muted"}>
                  {product.is_featured ? "Yes" : "No"}
                </StatusPill>
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(product.created_at)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{formatDate(product.updated_at)}</dd>
            </div>
          </dl>

          {product.description && (
            <p className="admin-product-description">{product.description}</p>
          )}

          {product.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt={product.name}
              className="admin-product-image"
            />
          )}
        </SectionCard>

        <SectionCard
          title="Stock"
          description="Stock levels change only through the Stock In / Out workflow."
        >
          <dl className="admin-detail-list">
            <div>
              <dt>Quantity on hand</dt>
              <dd>
                <strong>{product.quantity}</strong>
              </dd>
            </div>
            <div>
              <dt>Reorder level</dt>
              <dd>{product.minimum_stock}</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>
                <StatusPill tone={stock.tone}>{stock.label}</StatusPill>
              </dd>
            </div>
          </dl>

          <p className="admin-note">
            To change stock, use{" "}
            <Link href="/admin/stock" className="admin-table-link">
              Stock In / Out
            </Link>
            . Editing this product never alters its quantity or movement history.
          </p>

          <h3 className="admin-subheading">Batches &amp; expiry</h3>
          {batches.length === 0 ? (
            <EmptyState
              title="No batches recorded"
              hint="Batches with expiry dates appear here once recorded."
            />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Batch</th>
                    <th>Expires</th>
                    <th className="admin-num">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((batch) => {
                    const days = daysUntil(batch.expiration_date);
                    return (
                      <tr key={batch.id}>
                        <td>{batch.batch_number ?? "—"}</td>
                        <td>{formatDate(batch.expiration_date)}</td>
                        <td className="admin-num">{batch.quantity_remaining}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      {isSuperAdmin && (
        <SectionCard
          title="Lifecycle"
          description="Archive discontinued products to keep their history. Deletion is blocked when history exists."
        >
          <ProductActions
            id={product.id}
            status={product.status}
            canDelete={decision.allowed}
            deleteBlockedReason={decision.allowed ? null : decision.reason}
          />
        </SectionCard>
      )}

      {!isSuperAdmin && (
        <p className="admin-note">
          You are signed in as Staff. Editing and archiving products is reserved for Super Admins.
        </p>
      )}
    </>
  );
}
