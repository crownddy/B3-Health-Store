import { requireAdmin } from "@/lib/auth";
import { getDashboardMetrics, getProducts } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, StatCard, money } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage() {
  await requireAdmin();
  const [products, metrics] = await Promise.all([getProducts(), getDashboardMetrics()]);

  const sorted = [...products].sort((a, b) => {
    const rank = (q: number, min: number) => (q <= 0 ? 0 : q <= min ? 1 : 2);
    return rank(a.quantity, a.minimum_stock) - rank(b.quantity, b.minimum_stock);
  });

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">STOCK CONTROL</p>
          <h1>Inventory</h1>
          <p className="admin-page-sub">Current stock levels, values and reorder alerts.</p>
        </div>
      </div>

      <div className="admin-stats">
        <StatCard label="Stock units" value={String(metrics.stockUnits)} hint="Total on hand" />
        <StatCard
          label="Inventory value"
          value={money(metrics.inventoryValue)}
          hint="At selling price"
        />
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
                  <th className="admin-num">Min</th>
                  <th className="admin-num">Stock value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((product) => {
                  const status =
                    product.quantity <= 0
                      ? { tone: "danger" as const, label: "Out of stock" }
                      : product.quantity <= product.minimum_stock
                        ? { tone: "warn" as const, label: "Low stock" }
                        : { tone: "good" as const, label: "In stock" };
                  return (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.shelf_number ?? "—"}</td>
                      <td className="admin-num">{product.quantity}</td>
                      <td className="admin-num">{product.minimum_stock}</td>
                      <td className="admin-num">
                        {money(Number(product.selling_price) * Number(product.quantity))}
                      </td>
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
    </>
  );
}
