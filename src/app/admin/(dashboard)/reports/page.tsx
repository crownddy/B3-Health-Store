import { requireAdmin } from "@/lib/auth";
import { getDashboardMetrics, getProducts } from "@/lib/data";
import { SectionCard, StatCard, EmptyState, money, relationName } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  await requireAdmin();
  const [metrics, products] = await Promise.all([getDashboardMetrics(), getProducts()]);

  const topByValue = [...products]
    .map((product) => ({
      id: product.id,
      name: product.name,
      quantity: product.quantity,
      value: Number(product.selling_price ?? 0) * Number(product.quantity ?? 0)
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const lowStockRate =
    metrics.totalProducts > 0
      ? Math.round((metrics.lowStockCount / metrics.totalProducts) * 100)
      : 0;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">ANALYTICS</p>
          <h1>Reports</h1>
          <p className="admin-page-sub">
            Snapshot of store performance. Figures are computed live from the database.
          </p>
        </div>
      </div>

      <div className="admin-stats">
        <StatCard
          label="Inventory value"
          value={money(metrics.inventoryValue)}
          hint="Selling price × quantity"
        />
        <StatCard label="Stock units" value={String(metrics.stockUnits)} hint="Total on hand" />
        <StatCard label="Products" value={String(metrics.totalProducts)} hint="In catalogue" />
        <StatCard
          label="Published on homepage"
          value={String(metrics.visibleProducts)}
          hint="Visible to shoppers"
        />
        <StatCard
          label="Low stock rate"
          value={`${lowStockRate}%`}
          tone={lowStockRate > 20 ? "warn" : "default"}
          hint="Share of products below minimum"
        />
        <StatCard
          label="Expiry risk"
          value={String(metrics.expiringSoonCount + metrics.expiredCount)}
          tone={metrics.expiredCount > 0 ? "danger" : "default"}
          hint="Expired or expiring soon"
        />
      </div>

      <SectionCard
        title="Stock value by product"
        description="Top 10 products by value of stock on hand."
      >
        {topByValue.length === 0 ? (
          <EmptyState title="No data to report" hint="Add products to generate reports." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="admin-num">Qty</th>
                  <th className="admin-num">Stock value</th>
                </tr>
              </thead>
              <tbody>
                {topByValue.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td className="admin-num">{row.quantity}</td>
                    <td className="admin-num">{money(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Recent activity" description="Latest recorded movements.">
        {metrics.recentMovements.length === 0 ? (
          <EmptyState title="No activity yet" hint="Stock movements will appear here." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="admin-num">Qty</th>
                </tr>
              </thead>
              <tbody>
                {metrics.recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{relationName(movement.products)}</td>
                    <td>{movement.movement_type.replace("_", " ")}</td>
                    <td className="admin-num">{movement.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
