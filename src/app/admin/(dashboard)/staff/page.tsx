import { requireSuperAdmin } from "@/lib/auth";
import { getStaff } from "@/lib/data";
import { SectionCard, EmptyState, StatusPill, formatDate, roleLabel } from "@/components/admin/ui";
import RoleForm from "@/components/admin/RoleForm";

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  // Server-side gate: staff are redirected to /admin?denied=1 before render.
  const identity = await requireSuperAdmin();
  const staff = await getStaff();

  const superAdmins = staff.filter((member) => member.role === "super_admin").length;

  return (
    <>
      <div className="admin-page-head">
        <div>
          <p className="admin-eyebrow">ACCESS</p>
          <h1>Staff Management</h1>
          <p className="admin-page-sub">
            {staff.length} profile{staff.length === 1 ? "" : "s"} · {superAdmins} Super Admin
            {superAdmins === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <p className="admin-note">
        Roles are read from the <code>profiles</code> table. Changes take effect on the user&apos;s
        next request.
      </p>

      <SectionCard
        title="Team members"
        description="Promote or demote team members. You cannot remove your own Super Admin role."
      >
        {staff.length === 0 ? (
          <EmptyState
            title="No profiles yet"
            hint="Create Auth users in Supabase, then add a row in the profiles table."
          />
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>User ID</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th>Change role</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((member) => (
                  <tr key={member.id}>
                    <td>{member.full_name ?? "—"}</td>
                    <td className="admin-mono">{member.id.slice(0, 8)}…</td>
                    <td>
                      <StatusPill tone={member.role === "super_admin" ? "good" : "muted"}>
                        {roleLabel(member.role)}
                      </StatusPill>
                    </td>
                    <td>{formatDate(member.created_at)}</td>
                    <td>
                      <RoleForm
                        userId={member.id}
                        currentRole={member.role}
                        disabled={member.id === identity.user.id}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Adding a new team member" description="Provisioning is done in Supabase.">
        <ol className="admin-steps">
          <li>Create the user in Supabase → Authentication → Users.</li>
          <li>Copy their user ID.</li>
          <li>
            Insert a profile row:{" "}
            <code>
              insert into public.profiles (id, full_name, role) values (&apos;&lt;user-id&gt;&apos;,
              &apos;Name&apos;, &apos;staff&apos;);
            </code>
          </li>
          <li>They can now sign in. Promote them here when they need Super Admin rights.</li>
        </ol>
      </SectionCard>
    </>
  );
}
