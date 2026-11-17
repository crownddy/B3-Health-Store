import { formatDate } from "@/lib/format";
import { StatusPill } from "@/components/admin/ui";
import {
  EXPIRY_LABEL,
  classifyExpiry,
  expiryDetail,
  type ExpiryStatus
} from "@/lib/products/batches";

const TONE: Record<ExpiryStatus, "good" | "warn" | "danger" | "muted"> = {
  expired: "danger",
  expiring_soon: "warn",
  valid: "good",
  no_date: "muted"
};

/** Status pill for a batch's expiration date, shared by the batch tables. */
export function BatchExpiryPill({ expirationDate }: { expirationDate: string | null }) {
  const status = classifyExpiry(expirationDate);
  return <StatusPill tone={TONE[status]}>{EXPIRY_LABEL[status]}</StatusPill>;
}

export type BatchTableRow = {
  id: string;
  batch_number: string | null;
  expiration_date: string | null;
  quantity_remaining: number;
  productName?: string;
};

/**
 * Renders a product's (or the store's) batches with batch number, available
 * quantity and expiration date, and clearly marks expired / expiring-soon /
 * valid batches.
 */
export default function BatchTable({
  rows,
  showProduct = false
}: {
  rows: BatchTableRow[];
  showProduct?: boolean;
}) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            {showProduct && <th>Product</th>}
            <th>Batch</th>
            <th>Expires</th>
            <th>Detail</th>
            <th className="admin-num">Available</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {showProduct && <td>{row.productName ?? "—"}</td>}
              <td className="admin-mono">{row.batch_number ?? "—"}</td>
              <td>{formatDate(row.expiration_date)}</td>
              <td>{expiryDetail(row.expiration_date)}</td>
              <td className="admin-num">{row.quantity_remaining}</td>
              <td>
                <BatchExpiryPill expirationDate={row.expiration_date} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
