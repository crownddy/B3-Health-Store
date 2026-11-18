import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import {
  getProduct,
  getProductBatches,
  getProductMovements
} from "@/lib/data";
import {
  SectionCard,
  EmptyState,
  StatusPill,
  StatCard,
  money,
  formatDate
} from "@/components/admin/ui";
import BatchTable from "@/components/admin/BatchTable";
import InventoryDeleteButton from "@/components/admin/InventoryDeleteButton";
import { ExpiryStatusPill } from "@/components/admin/ExpiryPill";
import { productExpiryStatus } from "@/lib/products/batches";
import { stockStatus } from "@/lib/products/stock";

export const dynamic = "force-dynamic";

const MOVEMENT_LABEL: Record<string, string> = {
  stock_in: "Stock in",
  stock_out: "Stock out",
  adjustment: "Adjustment"
};

export default async function InventoryProductPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";
  const { id } = await params;

  const product = await getProduct(id);
  if (!product) notFound();

  const [batches, movements] = await Promise.all([
    getProductBatches(id),
    getProductMovements(id, 50)
  ]);

  const stock = stockStatus(product.quantity, product.minimum_stock);
  const expiry = productExpiryStatus(batches);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">INVENTORY</p>
          <h1>{product.name}</h1>
          <p className="admin-page-sub">
            {product.category ?? "Uncategorised"} ·{" "}
            <StatusPill tone={product.status === "active" ? "good" : "muted"}>
              {product.status === "active" ? "Active" : "Archived"}
            </StatusPill>
          </p>
        </div>
        <div className="admin-page-head-actions">
          <Link href="/admin/inventory" className="admin-link-quiet">
            ← Back to inventory
          </Link>
          {isSuperAdmin && (
            <Link
              href={`/admin/products/${product.id}/edit`}
              className="admin-button admin-button-inline"
            >
              Edit product
            </Link>
          )}
        </div>
      </div>

      <div className="admin-stats">
        <StatCard
          label="Available"
          value={String(product.quantity)}
          hint={stock.label}
          tone={stock.tone === "good" ? "good" : stock.tone === "warn" ? "warn" : "danger"}
        />
        <StatCard label="Batches" value={String(batches.length)} hint="Tracked lots" />
        <StatCard label="Selling price" value={money(product.selling_price)} hint="Per unit" />
      </div>

      <div className="admin-grid-2">
        <SectionCard title="Product" description="Image and identifying details.">
          <div className="admin-detail-image">
            {product.image_url ? (
              <Image
                src={product.image_url}
                alt={product.name}
                width={480}
                height={480}
                unoptimized
              />
            ) : (
              <div className="admin-detail-placeholder" aria-hidden="true">
                B3
              </div>
            )}
          </div>

          <dl className="admin-detail-list">
            <div>
              <dt>Available quantity</dt>
              <dd>
                <strong>{product.quantity}</strong>
              </dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>
                <StatusPill tone={stock.tone}>{stock.label}</StatusPill>
              </dd>
            </div>
            <div>
              <dt>Expiration</dt>
              <dd>
                <ExpiryStatusPill status={expiry} />
              </dd>
            </div>
            <div>
              <dt>Shelf number</dt>
              <dd>{product.shelf_number ?? "—"}</dd>
            </div>
          </dl>

          {product.description && (
            <p className="admin-product-description">{product.description}</p>
          )}

          <p className="admin-note">
            Stock changes only through{" "}
            <Link href="/admin/stock" className="admin-table-link">
              Stock In / Out
            </Link>
            . Editing a batch&apos;s expiry below never changes quantities or movement history.
          </p>
        </SectionCard>

        <SectionCard
          title="Batches"
          description="Every batch with its number, available quantity and expiration status."
        >
          {batches.length === 0 ? (
            <EmptyState
              title="No batches recorded"
              hint="Receive stock with an expiration date to track batches here."
            />
          ) : (
            <BatchTable
              rows={batches.map((batch) => ({
                id: batch.id,
                batch_number: batch.batch_number,
                expiration_date: batch.expiration_date,
                quantity_remaining: batch.quantity_remaining
              }))}
              editableProductId={isSuperAdmin ? product.id : undefined}
            />
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Stock movement history"
        description="Newest first. History is preserved and never rewritten."
      >
        {movements.length === 0 ? (
          <EmptyState
            title="No movements recorded"
            hint="Stock in and stock out activity will appear here."
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th className="admin-num">Qty</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => (
                  <tr key={movement.id}>
                    <td>{formatDate(movement.created_at)}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {isSuperAdmin && (
        <SectionCard
          title="Lifecycle"
          description="Delete removes the product from the catalogue. Batches and stock-movement history are preserved."
        >
          <div className="admin-row-actions">
            <InventoryDeleteButton id={product.id} name={product.name} />
          </div>
        </SectionCard>
      )}

      {!isSuperAdmin && (
        <p className="admin-note">
          You are signed in as Staff. Deleting products and editing batch expiry is reserved for
          Super Admins.
        </p>
      )}
    </>
  );
}
