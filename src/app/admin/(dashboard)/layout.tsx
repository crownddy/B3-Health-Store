import Link from "next/link";
import Image from "next/image";
import AdminNav from "@/components/admin/AdminNav";
import LogoutButton from "@/components/admin/LogoutButton";
import { requireAdmin } from "@/lib/auth";
import { roleLabel } from "@/lib/format";

export default async function AdminDashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  // Server-side gate: redirects to /admin/login when not signed in or not
  // provisioned. Runs before any child renders.
  const identity = await requireAdmin();
  const isSuperAdmin = identity.role === "super_admin";

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-sidebar-brand">
          <Image
            src="/b3-health-store-logo.jpg"
            alt="B3 Health Store"
            width={44}
            height={44}
          />
          <span>
            <strong>B3 Health Store</strong>
            <small>Admin console</small>
          </span>
        </Link>

        <AdminNav isSuperAdmin={isSuperAdmin} />
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-user">
            <span className="admin-avatar" aria-hidden="true">
              {(identity.fullName ?? identity.user.email ?? "A").trim().charAt(0).toUpperCase()}
            </span>
            <span className="admin-user-meta">
              <strong>{identity.fullName ?? identity.user.email}</strong>
              <small className={`admin-role admin-role-${identity.role}`}>
                {roleLabel(identity.role)}
              </small>
            </span>
          </div>
          <div className="admin-topbar-actions">
            <Link href="/" className="admin-link-quiet">
              View store
            </Link>
            <LogoutButton />
          </div>
        </header>

        <main className="admin-content">{children}</main>
      </div>
    </div>
  );
}
