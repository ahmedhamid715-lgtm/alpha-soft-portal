"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertCircle } from "lucide-react";
import { transferOwnershipAction, type SettingsActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/shared/combobox";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: SettingsActionState = {};

/**
 * Ownership transfer (spec sections 20/21/34) — a Combobox picks the
 * target member, then a SEPARATE explicit `ConfirmDialog` step is
 * required before the transfer actually runs (spec section 21: "explicit
 * confirmation, not a one-click action"). `fromMembershipId` never
 * appears in this component at all — `transferOwnership()` derives it
 * server-side from the caller's own verified membership.
 *
 * Calls `transferOwnershipAction()` directly (awaited), not via
 * `useActionState` — a successful transfer means the caller is no
 * longer the owner, so `settings/page.tsx`'s own `isOwner` check
 * unmounts this ENTIRE component on the next revalidated render. That
 * unmount can land in the SAME React commit as `useActionState`'s own
 * state update, so a `useEffect` reacting to `state.success` sometimes
 * never gets to run at all before the component is gone (found by this
 * module's own E2E testing — the transfer genuinely succeeded every
 * time, but neither the inline alert nor an effect-fired toast reliably
 * appeared). Calling the action directly and firing the toast the
 * moment the awaited promise resolves has no such race — it doesn't
 * depend on a subsequent render happening at all.
 */
export function OwnershipTransferDialog({ organizationId, members }: { organizationId: string; members: ComboboxOption[] }) {
  const [selected, setSelected] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  const selectedLabel = members.find((m) => m.value === selected)?.label;

  function confirm() {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    formData.set("toMembershipId", selected);
    setConfirmOpen(false);
    startTransition(async () => {
      const result = await transferOwnershipAction(initialState, formData);
      if (result.error) {
        setError(result.error);
      } else {
        setError(undefined);
        toast.success("Ownership transferred.");
      }
    });
  }

  if (members.length === 0) {
    return <p className="text-sm text-muted-foreground">No other active members are eligible to become owner yet.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Combobox
          options={members}
          value={selected}
          onChange={setSelected}
          placeholder="Choose a new owner…"
          className="sm:max-w-xs"
        />
        <Button variant="destructive" disabled={!selected} onClick={() => setConfirmOpen(true)}>
          Transfer ownership
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Transfer ownership?"
        description={`${selectedLabel ?? "This member"} will become the organization owner. You will be demoted to admin. This cannot be undone from this screen.`}
        confirmLabel="Transfer ownership"
        variant="destructive"
        loading={pending}
        onConfirm={confirm}
      />
    </div>
  );
}
