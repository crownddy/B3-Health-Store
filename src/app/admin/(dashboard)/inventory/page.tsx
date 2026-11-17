import { requireAdmin } from "@/lib/auth";
import { getBatches, getDashboardMetrics, getProducts, relationName } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, StatCard } from "@/components/admin/ui";
import BatchTable from "@/components/admin/BatchTable";
import ExpiryFilter from "@/components/admin/ExpiryFilter";
import { filterBatchesByExpiry, classifyExpiry, type ExpiryStatus } from "@/lib/products/batches";
import { stockStatus } from "@/lib/products/stock";

export const dynamic = "force-dynamic";

function readExpiry(value: string | string[] | undefined): ExpiryStatus | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "expired" || raw === "expiring_soon" || raw === "valid" || raw === "no_date"
    ? raw
    : "all";
}

export default async function AdminInventoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const expiry = readExpiry(params.expiry);

  const [products, metrics, batches] = await Promise.all([
    getProducts(),
    getDashboardMetrics(),
    getBatches()
  ]);

  const sorted = [...products].sort((a, b) => {
    const rank = (q: number, min: number) => (q <= 0 ? 0 : q <= min ? 1 : 2);
    return rank(a.quantity, a.minimum_stock) - rank(b.quantity, b.minimum_stock);
  });

  const batchRows = filterBatchesByExpiry(batches, expiry).map((batch) => ({
    id: batch.id,
    batch_number: batch.batch_number,
    expiration_date: batch.expiration_date,
    quantity_remaining: batch.quantity_remaining,
    productName: relationName(batch.products)
  }));

  const expiredCount = batches.filter(
    (batch) => classifyExpiry(batch.expiration_date) === "expired"
  ).length;
  const expiringSoonCount = batches.filter(
    (batch) => classifyExpiry(batch.expiration_date) === "expiring_soon"
  ).length;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">STOCK CONTROL</p>
          <h1>Inventory</h1>
          <p className="admin-page-sub">
            Current stock levels, per-batch expiry and reorder alerts.
          </p>
        </div>
      </div>

      <div className="admin-stats">
        <StatCard label="Stock units" value={String(metrics.stockUnits)} hint="Total on hand" />
        <StatCard
          label="Low stock"
          value={String(metrics.lowStockCount)}
          tone={metrics.lowStockCount > 0 ? "warn" : "default"}
          hint="At or below minimum"
        />
        <StatCard
          label="Out of stock"
          value={String(metrics.outOfStockCount)}
          tone={metrics.outOfStockCount > 0 ? "danger" : "default"}
          hint="Needs restocking"
        />
      </div>

      <SectionCard
        title="Stock by product"
        description="Ordered by urgency: out of stock first, then low stock."
      >
        {sorted.length === 0 ? (
          <EmptyState title="No products to track" hint="Add products to see inventory levels." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Shelf</th>
                  <th className="admin-num">Qty</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((product) => {
                  const status = stockStatus(product.quantity, product.minimum_stock);
                  return (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.shelf_number ?? "—"}</td>
                      <td className="admin-num">{product.quantity}</td>
                      <td>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Batches & expiry"
        description={`Every batch with its number, available quantity and expiry. ${expiredCount} expired · ${expiringSoonCount} expiring soon.`}
        actions={<ExpiryFilter basePath="/admin/inventory" />}
      >
        {batches.length === 0 ? (
          <EmptyState
            title="No batches recorded"
            hint="Receive stock with an expiration date to track batches here."
          />
        ) : batchRows.length === 0 ? (
          <EmptyState title="No batches match this filter" hint="Try a different expiration status." />
        ) : (
          <BatchTable rows={batchRows} showProduct />
        )}
      </SectionCard>
    </>
  );
}
