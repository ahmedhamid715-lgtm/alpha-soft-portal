"use client";

import { useActionState } from "react";
import { switchOrganizationAction, type SwitchOrganizationActionState } from "./actions";

const initialState: SwitchOrganizationActionState = {};

export function SwitchOrganizationForm({ organizationId, disabled }: { organizationId: string; disabled: boolean }) {
  const [state, formAction, pending] = useActionState(switchOrganizationAction, initialState);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <button
        type="submit"
        disabled={disabled || pending}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Switching…" : "Switch to this organization"}
      </button>
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
    </form>
  );
}
