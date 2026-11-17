import { requireAdmin } from "@/lib/auth";
import { getBatches, relationName } from "@/lib/data";
import { SectionCard, EmptyState, StatCard } from "@/components/admin/ui";
import BatchTable from "@/components/admin/BatchTable";
import ExpiryFilter from "@/components/admin/ExpiryFilter";
import {
  EXPIRING_SOON_DAYS,
  classifyExpiry,
  filterBatchesByExpiry,
  type ExpiryStatus
} from "@/lib/products/batches";

export const dynamic = "force-dynamic";

function readExpiry(value: string | string[] | undefined): ExpiryStatus | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "expired" || raw === "expiring_soon" || raw === "valid" || raw === "no_date"
    ? raw
    : "all";
}

export default async function AdminExpiryPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const expiry = readExpiry(params.expiry);

  const batches = await getBatches();
  const rows = batches.map((batch) => ({
    id: batch.id,
    batch_number: batch.batch_number,
    expiration_date: batch.expiration_date,
    quantity_remaining: batch.quantity_remaining,
    productName: relationName(batch.products)
  }));

  const filtered = filterBatchesByExpiry(rows, expiry);
  const expired = rows.filter((row) => classifyExpiry(row.expiration_date) === "expired");
  const soon = rows.filter((row) => classifyExpiry(row.expiration_date) === "expiring_soon");
  const valid = rows.filter((row) => classifyExpiry(row.expiration_date) === "valid");

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">BATCHES</p>
          <h1>Expiry Management</h1>
          <p className="admin-page-sub">
            Expiry is computed per batch from <code>product_batches.expiration_date</code>.
          </p>
        </div>
      </div>

      <div className="admin-stats">
        <StatCard
          label="Expired"
          value={String(expired.length)}
          tone={expired.length > 0 ? "danger" : "good"}
          hint="Remove from sale"
        />
        <StatCard
          label={`Expiring ≤ ${EXPIRING_SOON_DAYS} days`}
          value={String(soon.length)}
          tone={soon.length > 0 ? "warn" : "default"}
          hint="Prioritise these"
        />
        <StatCard label="Valid" value={String(valid.length)} hint="Safe to sell" />
        <StatCard label="Tracked batches" value={String(rows.length)} hint="All recorded batches" />
      </div>

      {expired.length > 0 && expiry === "all" && (
        <SectionCard title="Expired batches" description="Do not sell these batches.">
          <BatchTable rows={expired} showProduct />
        </SectionCard>
      )}

      <SectionCard
        title="All batches"
        description="Batch number, available quantity and expiration status."
        actions={<ExpiryFilter basePath="/admin/expiry" />}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No batches recorded"
            hint="Receive stock with an expiration date to track expiry here."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No batches match this filter" hint="Try a different expiration status." />
        ) : (
          <BatchTable rows={filtered} showProduct />
        )}
      </SectionCard>
    </>
  );
}
