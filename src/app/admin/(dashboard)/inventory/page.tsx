import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getBatches, getDashboardMetrics, getProductReferenceCountsMany, getProducts } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, StatCard } from "@/components/admin/ui";
import BatchTable from "@/components/admin/BatchTable";
import ExpiryFilter from "@/components/admin/ExpiryFilter";
import InventoryFilters from "@/components/admin/InventoryFilters";
import InventoryDeleteButton from "@/components/admin/InventoryDeleteButton";
import ProductThumb from "@/components/admin/ProductThumb";
import { ExpiryStatusPill } from "@/components/admin/ExpiryPill";
import { filterBatchesByExpiry, classifyExpiry, type ExpiryStatus } from "@/lib/products/batches";
import {
  buildInventoryRows,
  filterByExpiryStatus,
  paginateInventory,
  searchInventory,
  INVENTORY_PAGE_SIZE
} from "@/lib/products/inventory";
import { canDeleteProduct } from "@/lib/products/policy";
import { stockStatus } from "@/lib/products/stock";
import { relationName } from "@/lib/format";

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

  const [products, metrics, batches] = await Promise.all([
    getProducts(),
    getDashboardMetrics(),
    getBatches()
  ]);

  const rows = buildInventoryRows(
    products.map((product) => ({
      id: product.id,
      name: product.name,
      category: product.category,
      image_url: product.image_url,
      quantity: product.quantity,
      minimum_stock: product.minimum_stock,
      status: product.status
    })),
    batches
  );

  // Server-side search + filter + paging: only the requested page of products is
  // ever sent to the browser, never the whole catalogue.
  const filtered = filterByExpiryStatus(searchInventory(rows, search), expiry);
  const page = paginateInventory(filtered, requestedPage, INVENTORY_PAGE_SIZE);

  // Reference counts are only fetched for the products actually shown.
  const references = isSuperAdmin
    ? await getProductReferenceCountsMany(page.items.map((row) => row.id))
    : new Map<string, { stockMovements: number; batches: number }>();

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
            ? "Search, review expiry and manage each product. Deleting is blocked while history exists."
            : "Read-only view. Deleting and archiving products requires Super Admin."
        }
      >
        <InventoryFilters total={page.total} page={page.page} pages={page.pages} />

        {rows.length === 0 ? (
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
                  const decision = canDeleteProduct(
                    references.get(row.id) ?? { stockMovements: 0, batches: 0 }
                  );
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
                            <InventoryDeleteButton id={row.id} name={row.name} status={row.status} />
                          )}
                        </div>
                        {isSuperAdmin && !decision.allowed && (
                          <small className="admin-field-hint">Has history — archive instead.</small>
                        )}
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
