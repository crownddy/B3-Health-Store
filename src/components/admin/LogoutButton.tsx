"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    setBusy(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Even if the network call fails, fall through to the login page.
    }
    router.replace("/admin/login");
    router.refresh();
  }

  return (
    <button type="button" className="admin-logout" onClick={handleLogout} disabled={busy}>
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
