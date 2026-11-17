import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getDashboardMetrics, relationName } from "@/lib/data";
import {
  StatCard,
  SectionCard,
  EmptyState,
  StatusPill,
  formatDate
} from "@/components/admin/ui";

export const dynamic = "force-dynamic";

const MOVEMENT_LABEL: Record<string, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment: "Adjustment"
};

export default async function AdminOverviewPage({
  searchParams
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const identity = await requireAdmin();
  const { denied } = await searchParams;
  const isSuperAdmin = identity.role === "super_admin";
  const metrics = await getDashboardMetrics();

  return (
    <>
      {denied === "1" && (
        <p className="admin-alert admin-alert-warn" role="status">
          Super Admin access is required for that section. You are signed in as Staff.
        </p>
      )}

      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">OVERVIEW</p>
          <h1>Welcome back, {identity.fullName ?? "Admin"}</h1>
          <p className="admin-page-sub">
            Live figures from your store database. Signed in as{" "}
            {isSuperAdmin ? "Super Admin" : "Staff"}.
          </p>
        </div>
      </div>

      <div className="admin-stats">
        <StatCard
          label="Products"
          value={String(metrics.totalProducts)}
          hint={`${metrics.visibleProducts} visible on homepage`}
        />
        <StatCard
          label="Stock units"
          value={String(metrics.stockUnits)}
          hint="Total quantity on hand"
        />
        <StatCard
          label="Categories"
          value={String(metrics.totalCategories)}
          hint="Product groupings"
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
        <StatCard
          label="Expiring in 30 days"
          value={String(metrics.expiringSoonCount)}
          tone={metrics.expiringSoonCount > 0 ? "warn" : "default"}
          hint="Review batches"
        />
        <StatCard
          label="Expired batches"
          value={String(metrics.expiredCount)}
          tone={metrics.expiredCount > 0 ? "danger" : "good"}
          hint="Remove from sale"
        />
      </div>

      <div className="admin-grid-2">
        <SectionCard
          title="Low stock products"
          description="Quantity is at or below the configured minimum."
          actions={
            <Link href="/admin/inventory" className="admin-link-quiet">
              Inventory
            </Link>
          }
        >
          {metrics.lowStockProducts.length === 0 ? (
            <EmptyState title="Nothing below minimum" hint="All products are above their minimum stock." />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Shelf</th>
                    <th className="admin-num">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.lowStockProducts.map((product) => (
                    <tr key={product.id}>
                      <td>{product.name}</td>
                      <td>{product.shelf_number ?? "—"}</td>
                      <td className="admin-num">{product.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Expiring batches"
          description="Batches expiring within the next 30 days."
          actions={
            <Link href="/admin/expiry" className="admin-link-quiet">
              Expiry
            </Link>
          }
        >
          {metrics.expiringBatches.length === 0 ? (
            <EmptyState title="No upcoming expiries" hint="No batches expire in the next 30 days." />
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Batch</th>
                    <th>Expires</th>
                    <th className="admin-num">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.expiringBatches.map((batch) => (
                    <tr key={batch.id}>
                      <td>{relationName(batch.products)}</td>
                      <td>{batch.batch_number ?? "—"}</td>
                      <td>{formatDate(batch.expiration_date)}</td>
                      <td className="admin-num">{batch.quantity_remaining}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Recent stock movements"
        description="Latest stock in, stock out and adjustment activity."
        actions={
          <Link href="/admin/stock" className="admin-link-quiet">
            Record movement
          </Link>
        }
      >
        {metrics.recentMovements.length === 0 ? (
          <EmptyState
            title="No stock movements yet"
            hint="Record a stock in or stock out to see activity here."
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="admin-num">Qty</th>
                  <th>Note</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {metrics.recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{relationName(movement.products)}</td>
                    <td>
                      <StatusPill
                        tone={
                          movement.movement_type === "stock_in"
                            ? "good"
                            : movement.movement_type === "stock_out"
                              ? "warn"
                              : "muted"
                        }
                      >
                        {MOVEMENT_LABEL[movement.movement_type] ?? movement.movement_type}
                      </StatusPill>
                    </td>
                    <td className="admin-num">{movement.quantity}</td>
                    <td>{movement.note ?? "—"}</td>
                    <td>{formatDate(movement.created_at)}</td>
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
