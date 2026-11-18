import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import {
  getDashboardMetrics,
  getInventoryBatches,
  getInventoryProducts
} from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, StatCard } from "@/components/admin/ui";
import BatchTable from "@/components/admin/BatchTable";
import ExpiryFilter from "@/components/admin/ExpiryFilter";
import InventoryFilters from "@/components/admin/InventoryFilters";
import InventoryDeleteButton from "@/components/admin/InventoryDeleteButton";
import ProductThumb from "@/components/admin/ProductThumb";
import { ExpiryStatusPill } from "@/components/admin/ExpiryPill";
import type { ExpiryStatus } from "@/lib/products/batches";
import { INVENTORY_PAGE_SIZE, toInventoryPage } from "@/lib/products/inventory";
import { stockStatus } from "@/lib/products/stock";

export const dynamic = "force-dynamic";

function readExpiry(value: string | string[] | undefined): ExpiryStatus | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "expired" || raw === "expiring_soon" || raw === "valid" || raw === "no_date"
    ? raw
    : "all";
}

function readString(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim();
}

function readPage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "0", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export default async function AdminInventoryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const params = await searchParams;

  const search = readString(params.q);
  const expiry = readExpiry(params.expiry);
  const requestedPage = readPage(params.page);

  const [metrics, inventory, batchPage] = await Promise.all([
    getDashboardMetrics(),
    getInventoryProducts(search, expiry, requestedPage, INVENTORY_PAGE_SIZE),
    getInventoryBatches(expiry)
  ]);

  // The database did the search, expiry filter and paging; this only maps the
  // requested page into the rows the table renders.
  const page = toInventoryPage(inventory);
  // Distinguishes "nothing in the catalogue" from "nothing matches this filter".
  const hasProducts = metrics.totalProducts > 0;

  const batchRows = batchPage.items.map((batch) => ({
    id: batch.id,
    batch_number: batch.batch_number,
    expiration_date: batch.expiration_date,
    quantity_remaining: batch.quantity_remaining,
    productName: batch.product_name ?? undefined
  }));

  const expiredCount = batchPage.expired;
  const expiringSoonCount = batchPage.expiringSoon;

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

      {params.deleted && (
        <p className="admin-alert admin-alert-ok" role="status">
          Product deleted.
        </p>
      )}

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
        title="Products"
        description={
          isSuperAdmin
            ? "Search, review expiry and manage each product. Deleting removes a product from the catalogue while its history is kept."
            : "Read-only view. Deleting and archiving products requires Super Admin."
        }
      >
        <InventoryFilters total={page.total} page={page.page} pages={page.pages} />

        {!hasProducts ? (
          <EmptyState title="No products to track" hint="Add products to see inventory levels." />
        ) : page.items.length === 0 ? (
          <EmptyState
            title="No products match your filters"
            hint="Try a different search term or expiration status."
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-inventory">
              <thead>
                <tr>
                  <th>Product</th>
                  <th className="admin-num">Available</th>
                  <th>Expiration</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => {
                  const stock = stockStatus(row.quantity, row.minimum_stock);
                  return (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-inventory-product">
                          <ProductThumb src={row.image_url} alt={row.name} />
                          <div className="admin-inventory-product-meta">
                            <Link href={`/admin/inventory/${row.id}`} className="admin-table-link">
                              {row.name}
                            </Link>
                            <small className="admin-inventory-sub">
                              {row.category ?? "Uncategorised"} · {row.batchCount} batch
                              {row.batchCount === 1 ? "" : "es"}
                              {row.status === "archived" ? " · Archived" : ""}
                            </small>
                          </div>
                        </div>
                      </td>
                      <td className="admin-num">
                        <strong>{row.quantity}</strong>
                        <div>
                          <StatusPill tone={stock.tone}>{stock.label}</StatusPill>
                        </div>
                      </td>
                      <td>
                        <ExpiryStatusPill status={row.expiryStatus} />
                      </td>
                      <td>
                        <div className="admin-row-actions">
                          <Link href={`/admin/inventory/${row.id}`} className="admin-button-small">
                            View details
                          </Link>
                          {isSuperAdmin && (
                            <InventoryDeleteButton id={row.id} name={row.name} />
                          )}
                        </div>
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
        {batchPage.total === 0 ? (
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
