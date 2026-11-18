import { formatDate } from "@/lib/format";
import { expiryDetail } from "@/lib/products/batches";
import { BatchExpiryPill } from "@/components/admin/ExpiryPill";
import BatchExpiryEditor from "@/components/admin/BatchExpiryEditor";

export { BatchExpiryPill } from "@/components/admin/ExpiryPill";

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
 *
 * When `editableProductId` is given (a Super Admin viewing one product's
 * batches), each row gets a control to set that batch's expiration date. The
 * control writes only the expiration date, never a quantity.
 */
export default function BatchTable({
  rows,
  showProduct = false,
  editableProductId
}: {
  rows: BatchTableRow[];
  showProduct?: boolean;
  editableProductId?: string;
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
            {editableProductId && <th>Set expiry</th>}
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
              {editableProductId && (
                <td>
                  <BatchExpiryEditor
                    batchId={row.id}
                    productId={editableProductId}
                    expirationDate={row.expiration_date}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
