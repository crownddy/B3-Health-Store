"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/auth";

export type RoleActionState = {
  ok: boolean;
  message: string;
};

/**
 * Changes a user's role in `profiles`.
 *
 * Only a super_admin may call this. The check runs server-side against the
 * database, and Supabase Row Level Security enforces the same rule on the
 * update itself. A user cannot promote themselves: the role always comes from
 * the session's profile row, never from the submitted form.
 */
export async function updateStaffRole(
  _prev: RoleActionState | undefined,
  formData: FormData
): Promise<RoleActionState> {
  const identity = await requireSuperAdmin();

  const userId = String(formData.get("user_id") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();

  if (!userId) return { ok: false, message: "Missing user." };
  if (!["staff", "super_admin"].includes(role)) {
    return { ok: false, message: "Choose either Staff or Super Admin." };
  }

  if (userId === identity.user.id && role !== "super_admin") {
    return { ok: false, message: "You cannot remove your own Super Admin role." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);

  if (error) return { ok: false, message: `Could not update role: ${error.message}` };

  revalidatePath("/admin/staff");
  revalidatePath("/admin");
  return { ok: true, message: `Role updated to ${role === "super_admin" ? "Super Admin" : "Staff"}.` };
}
