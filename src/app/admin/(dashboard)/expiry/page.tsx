import { requireAdmin } from "@/lib/auth";
import { getBatches, relationName } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, StatCard, formatDate, daysUntil } from "@/components/admin/ui";

export const dynamic = "force-dynamic";

function statusFor(days: number | null) {
  if (days === null) return { tone: "muted" as const, label: "No date" };
  if (days < 0) return { tone: "danger" as const, label: `Expired ${Math.abs(days)}d ago` };
  if (days === 0) return { tone: "danger" as const, label: "Expires today" };
  if (days <= 30) return { tone: "warn" as const, label: `${days} days left` };
  if (days <= 90) return { tone: "muted" as const, label: `${days} days left` };
  return { tone: "good" as const, label: `${days} days left` };
}

export default async function AdminExpiryPage() {
  await requireAdmin();
  const batches = await getBatches();

  const withDays = batches.map((batch) => ({ batch, days: daysUntil(batch.expiration_date) }));
  const expired = withDays.filter((row) => row.days !== null && row.days < 0);
  const soon = withDays.filter((row) => row.days !== null && row.days >= 0 && row.days <= 30);
  const upcoming = withDays.filter((row) => row.days !== null && row.days > 30);

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
          label="Expiring ≤ 30 days"
          value={String(soon.length)}
          tone={soon.length > 0 ? "warn" : "default"}
          hint="Prioritise these"
        />
        <StatCard label="Upcoming" value={String(upcoming.length)} hint="More than 30 days out" />
        <StatCard label="Tracked batches" value={String(batches.length)} hint="With an expiry date" />
      </div>

      {expired.length > 0 && (
        <SectionCard title="Expired batches" description="Do not sell these batches.">
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th>Expired</th>
                  <th className="admin-num">Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {expired.map(({ batch, days }) => {
                  const status = statusFor(days);
                  return (
                    <tr key={batch.id}>
                      <td>{relationName(batch.products)}</td>
                      <td>{batch.batch_number ?? "—"}</td>
                      <td>{formatDate(batch.expiration_date)}</td>
                      <td className="admin-num">{batch.quantity_remaining}</td>
                      <td>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Expiring soon" description="Batches expiring within 30 days.">
        {soon.length === 0 ? (
          <EmptyState title="Nothing expiring soon" hint="No batches expire in the next 30 days." />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th>Expires</th>
                  <th className="admin-num">Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {soon.map(({ batch, days }) => {
                  const status = statusFor(days);
                  return (
                    <tr key={batch.id}>
                      <td>{relationName(batch.products)}</td>
                      <td>{batch.batch_number ?? "—"}</td>
                      <td>{formatDate(batch.expiration_date)}</td>
                      <td className="admin-num">{batch.quantity_remaining}</td>
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

      <SectionCard title="All tracked batches" description="Every batch with a recorded expiry date.">
        {batches.length === 0 ? (
          <EmptyState
            title="No batch expiry dates"
            hint="Add batches with expiration dates to track expiry here."
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch</th>
                  <th>Expires</th>
                  <th className="admin-num">Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {withDays.map(({ batch, days }) => {
                  const status = statusFor(days);
                  return (
                    <tr key={batch.id}>
                      <td>{relationName(batch.products)}</td>
                      <td>{batch.batch_number ?? "—"}</td>
                      <td>{formatDate(batch.expiration_date)}</td>
                      <td className="admin-num">{batch.quantity_remaining}</td>
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
