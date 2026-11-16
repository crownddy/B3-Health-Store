import { requireSuperAdmin } from "@/lib/auth";
import { SectionCard, StatusPill } from "@/components/admin/ui";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const identity = await requireSuperAdmin();

  // Only booleans are surfaced. Secret values are never rendered or read here.
  const supabaseUrlSet = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKeySet = Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">CONFIGURATION</p>
          <h1>Settings</h1>
          <p className="admin-page-sub">Store configuration and connection status.</p>
        </div>
      </div>

      <SectionCard title="Supabase connection" description="Client-side configuration status.">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Setting</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>NEXT_PUBLIC_SUPABASE_URL</code>
                </td>
                <td>
                  <StatusPill tone={supabaseUrlSet ? "good" : "danger"}>
                    {supabaseUrlSet ? "Configured" : "Missing"}
                  </StatusPill>
                </td>
              </tr>
              <tr>
                <td>
                  <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
                </td>
                <td>
                  <StatusPill tone={anonKeySet ? "good" : "danger"}>
                    {anonKeySet ? "Configured" : "Missing"}
                  </StatusPill>
                </td>
              </tr>
              <tr>
                <td>Supabase client</td>
                <td>
                  <StatusPill tone={isSupabaseConfigured ? "good" : "danger"}>
                    {isSupabaseConfigured ? "Ready" : "Not configured"}
                  </StatusPill>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="admin-note">
          Only presence is shown — values are never displayed. The service-role key must never be
          placed in <code>NEXT_PUBLIC_*</code> variables or in client code.
        </p>
      </SectionCard>

      <SectionCard title="Your account" description="Signed-in Super Admin.">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <tbody>
              <tr>
                <th>Name</th>
                <td>{identity.fullName ?? "—"}</td>
              </tr>
              <tr>
                <th>Email</th>
                <td>{identity.user.email}</td>
              </tr>
              <tr>
                <th>Role</th>
                <td>
                  <StatusPill tone="good">Super Admin</StatusPill>
                </td>
              </tr>
              <tr>
                <th>User ID</th>
                <td className="admin-mono">{identity.user.id}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Security model" description="How access is controlled.">
        <ul className="admin-steps">
          <li>Authentication is handled by Supabase Auth (email + password).</li>
          <li>
            Roles are read from the <code>profiles</code> table on the server for every request.
          </li>
          <li>A role sent from the browser is never trusted.</li>
          <li>Row Level Security enforces the same rules directly in Postgres.</li>
          <li>The service-role key is never used in browser code.</li>
        </ul>
      </SectionCard>
    </>
  );
}
