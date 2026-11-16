"use client";

import { useActionState } from "react";
import { updateStaffRole, type RoleActionState } from "@/app/admin/(dashboard)/staff/actions";

const initialState: RoleActionState = { ok: false, message: "" };

export default function RoleForm({
  userId,
  currentRole,
  disabled
}: {
  userId: string;
  currentRole: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateStaffRole, initialState);
  const nextRole = currentRole === "super_admin" ? "staff" : "super_admin";

  return (
    <form action={formAction} className="admin-inline-form">
      <input type="hidden" name="user_id" value={userId} />
      <input type="hidden" name="role" value={nextRole} />
      <button type="submit" className="admin-button-small" disabled={pending || disabled}>
        {pending
          ? "Saving…"
          : nextRole === "super_admin"
            ? "Make Super Admin"
            : "Change to Staff"}
      </button>
      {state.message && (
        <span className={state.ok ? "admin-inline-ok" : "admin-inline-error"} role="status">
          {state.message}
        </span>
      )}
    </form>
  );
}
