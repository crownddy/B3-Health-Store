import { requireAdmin } from "@/lib/auth";
import { getProducts, getStockMovements, relationName } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, formatDate } from "@/components/admin/ui";
import StockMovementForm from "@/components/admin/StockMovementForm";

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment: "Adjustment"
};

export default async function AdminStockPage() {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const [products, movements] = await Promise.all([getProducts(), getStockMovements(50)]);

  const options = products.map((product) => ({
    id: product.id,
    name: product.name,
    quantity: product.quantity
  }));

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">MOVEMENTS</p>
          <h1>Stock In / Stock Out</h1>
          <p className="admin-page-sub">
            Record deliveries, sales and corrections. Each movement updates the product quantity.
          </p>
        </div>
      </div>

      <SectionCard
        title="Record a movement"
        description={
          isSuperAdmin
            ? "Writes are verified against your role and enforced by database Row Level Security."
            : "Recording stock movements is reserved for Super Admins."
        }
      >
        {isSuperAdmin ? (
          options.length === 0 ? (
            <EmptyState title="No products available" hint="Add products before recording stock." />
          ) : (
            <StockMovementForm products={options} />
          )
        ) : (
          <p className="admin-alert admin-alert-warn" role="status">
            You are signed in as Staff. Ask a Super Admin to record this movement.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Movement history" description="Most recent 50 movements.">
        {movements.length === 0 ? (
          <EmptyState title="No movements recorded" hint="Recorded movements will appear here." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="admin-num">Qty</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDate(movement.created_at)}</td>
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
                        {LABEL[movement.movement_type] ?? movement.movement_type}
                      </StatusPill>
                    </td>
                    <td className="admin-num">{movement.quantity}</td>
                    <td>{movement.note ?? "—"}</td>
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
