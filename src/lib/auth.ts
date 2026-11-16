import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export type AppRole = "staff" | "super_admin";

export type AdminIdentity = {
  user: User;
  fullName: string | null;
  role: AppRole;
};

/**
 * Returns the authenticated Supabase user, or null.
 *
 * getUser() revalidates the token against Supabase Auth. It is deliberately
 * used instead of getSession(), which trusts the cookie payload.
 */
export async function getSessionUser(): Promise<User | null> {
  if (!isSupabaseConfigured) return null;
  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/**
 * Resolves the signed-in admin together with the role stored in the `profiles`
 * table.
 *
 * Security notes:
 * - The role is read from the database through the user's own session, so Row
 *   Level Security applies. A role supplied by the browser is never trusted.
 * - A user with no `profiles` row is denied outright. Access is never granted
 *   by falling back to a default role.
 */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  if (!isSupabaseConfigured) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Unable to read admin profile: ${profileError.message}`);
  }

  if (!profile) return null;

  const role: AppRole = profile.role === "super_admin" ? "super_admin" : "staff";
  return { user, fullName: profile.full_name ?? null, role };
}

/**
 * Requires a signed-in, provisioned admin. Unauthenticated visitors go to the
 * login page; signed-in users without a profile are told they are not
 * provisioned.
 */
export async function requireAdmin(): Promise<AdminIdentity> {
  const identity = await getAdminIdentity();
  if (identity) return identity;

  const user = await getSessionUser();
  if (user) redirect("/admin/login?reason=not-provisioned");
  redirect("/admin/login");
}

/**
 * Requires the super_admin role. Authenticated staff are redirected to the
 * dashboard overview so they stay signed in but never reach a privileged
 * screen.
 */
export async function requireSuperAdmin(): Promise<AdminIdentity> {
  const identity = await requireAdmin();
  if (identity.role !== "super_admin") redirect("/admin?denied=1");
  return identity;
}
