import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/admin/LoginForm";
import { getAdminIdentity, getSessionUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Admin sign in · B3 Health Store"
};

export default async function AdminLoginPage({
  searchParams
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  // Already signed in *and provisioned*? Send them straight to the dashboard.
  // A signed-in user without a profile is deliberately kept on this page (with
  // an explanation) instead of being redirected to /admin, which would bounce
  // them straight back here and produce a redirect loop.
  let notProvisioned = reason === "not-provisioned";
  if (isSupabaseConfigured) {
    const identity = await getAdminIdentity();
    if (identity) redirect("/admin");
    if (await getSessionUser()) notProvisioned = true;
  }

  return <LoginForm notProvisioned={notProvisioned} />;
}
