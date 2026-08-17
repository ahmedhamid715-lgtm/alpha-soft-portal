"use client";

import { useId, useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { updatePreferenceAction } from "@/app/(protected)/settings/notifications/actions";

/**
 * One category/channel toggle on `/settings/notifications`. Optimistic:
 * flips immediately, calls the Server Action in a transition, and
 * reverts on failure (a rejected mandatory-channel change, a rate limit)
 * rather than leaving the switch showing a state the server didn't
 * accept — see `docs/architecture/notification-preferences.md`
 * "Server-side enforcement must match the UI."
 */
export function PreferenceToggle({
  category,
  channel,
  label,
  checked,
}: {
  category: string;
  channel: "IN_APP" | "EMAIL" | "SMS" | "PUSH";
  label: string;
  checked: boolean;
}) {
  const id = useId();
  const [pending, startTransition] = useTransition();

  const handleChange = (next: boolean) => {
    const formData = new FormData();
    formData.set("category", category);
    formData.set("channel", channel);
    formData.set("enabled", String(next));
    startTransition(async () => {
      await updatePreferenceAction({}, formData);
    });
  };

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <Label htmlFor={id} className="text-sm font-normal text-foreground">
        {label}
      </Label>
      <Switch id={id} checked={checked} disabled={pending} onCheckedChange={handleChange} aria-label={`${label} — ${checked ? "on" : "off"}`} />
    </div>
  );
}
