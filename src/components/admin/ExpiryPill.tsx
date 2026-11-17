import { StatusPill } from "@/components/admin/ui";
import { EXPIRY_LABEL, classifyExpiry, type ExpiryStatus } from "@/lib/products/batches";

export const EXPIRY_TONE: Record<ExpiryStatus, "good" | "warn" | "danger" | "muted"> = {
  expired: "danger",
  expiring_soon: "warn",
  valid: "good",
  no_date: "muted"
};

/** Status pill for an already-classified expiration status. */
export function ExpiryStatusPill({ status }: { status: ExpiryStatus }) {
  return <StatusPill tone={EXPIRY_TONE[status]}>{EXPIRY_LABEL[status]}</StatusPill>;
}

/** Status pill for a batch's expiration date, shared by the batch tables. */
export function BatchExpiryPill({ expirationDate }: { expirationDate: string | null }) {
  return <ExpiryStatusPill status={classifyExpiry(expirationDate)} />;
}
