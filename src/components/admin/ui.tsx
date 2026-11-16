import { money, formatDate, daysUntil, roleLabel, relationName } from "@/lib/format";

export function StatCard({
  label,
  value,
  hint,
  tone = "default"
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "warn" | "danger" | "good";
}) {
  return (
    <div className={`admin-stat admin-stat-${tone}`}>
      <span className="admin-stat-label">{label}</span>
      <strong className="admin-stat-value">{value}</strong>
      {hint && <small className="admin-stat-hint">{hint}</small>}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  actions,
  children
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="admin-empty">
      <strong>{title}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: "good" | "warn" | "danger" | "muted"; children: React.ReactNode }) {
  return <span className={`admin-pill admin-pill-${tone}`}>{children}</span>;
}

export { money, formatDate, daysUntil, roleLabel, relationName };
