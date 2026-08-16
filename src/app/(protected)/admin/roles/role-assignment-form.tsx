"use client";

import { useActionState } from "react";
import { assignRoleAction, type AssignRoleActionState } from "./actions";

export interface RoleOption {
  id: string;
  name: string;
  isSystem: boolean;
}

const initialState: AssignRoleActionState = {};

/**
 * One row's role-assignment control — a plain `<select>` (not the
 * Radix-based `Select` primitive) specifically so this stays a native
 * form field a Server Action can read via `formData.get("roleId")`
 * without client-side state syncing; see `docs/architecture/rbac.md`
 * "UI" for why that tradeoff is deliberate here. Every submission goes
 * through `assignRoleAction` → `role-service.ts`'s `assignRole()` — the
 * one chokepoint that authorizes, checks scope compatibility, and
 * enforces last-owner protection (spec sections 24–27). This component
 * has no authorization logic of its own; a disabled control here is UX
 * only (spec section 16) — the real enforcement is server-side
 * regardless of whether this control was ever rendered disabled.
 */
export function RoleAssignmentForm({
  membershipId,
  currentRoleId,
  options,
  disabled,
}: {
  membershipId: string;
  currentRoleId: string | null;
  options: RoleOption[];
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(assignRoleAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="membershipId" value={membershipId} />
      <label className="sr-only" htmlFor={`role-${membershipId}`}>
        Role
      </label>
      <select
        id={`role-${membershipId}`}
        name="roleId"
        defaultValue={currentRoleId ?? ""}
        disabled={disabled || pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="" disabled>
          Unassigned
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
            {option.isSystem ? "" : " (custom)"}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={disabled || pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      {state.success ? <span className="text-xs text-success">Saved</span> : null}
    </form>
  );
}
