"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { convertDealToClientAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";
const ROLES = [
  { role: "ACCOUNT_MANAGER" as const, label: "Account manager" },
  { role: "ONBOARDING_OWNER" as const, label: "Onboarding owner" },
  { role: "SERVICE_LEAD" as const, label: "Service lead" },
];

/** Shown only on an eligible deal's own detail page (the page itself resolves eligibility server-side — see `crm-client-onboarding-service.ts`'s own `resolveEligibility()`; this form never re-decides it). */
export function StartOnboardingForm({ dealId, users }: { dealId: string; users: User[] }) {
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const payload = Object.entries(assignments)
        .filter(([, userId]) => userId && userId !== UNASSIGNED)
        .map(([role, userId]) => ({ role, userId }));
      const result = await convertDealToClientAction({ dealId, assignments: payload.length > 0 ? payload : undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) router.push(`/admin/crm/onboarding/${result.data.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">This will link (or create) the client&apos;s own organization and start a new onboarding engagement. Optionally assign internal staff now — you can also do this later.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {ROLES.map(({ role, label }) => (
          <div key={role} className="flex flex-col gap-1.5">
            <Label htmlFor={`assign-${role}`}>{label}</Label>
            <Select value={assignments[role] ?? UNASSIGNED} onValueChange={(v) => setAssignments((prev) => ({ ...prev, [role]: v }))} disabled={pending}>
              <SelectTrigger id={`assign-${role}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <Button onClick={handleSubmit} disabled={pending} className="w-fit">
        Start onboarding
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
