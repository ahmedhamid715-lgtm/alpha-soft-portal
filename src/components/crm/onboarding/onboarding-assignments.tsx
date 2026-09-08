"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { assignOnboardingRoleAction } from "@/app/(protected)/admin/crm/actions";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmClientOnboardingAssignmentWithUser } from "@/server/repositories/crm-client-onboarding-assignment-repository";
import type { User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";
const ROLES = [
  { role: "ACCOUNT_MANAGER" as const, label: "Account manager" },
  { role: "ONBOARDING_OWNER" as const, label: "Onboarding owner" },
  { role: "SERVICE_LEAD" as const, label: "Service lead" },
];

/** Reassigning a role updates the existing row in place (no delete/recreate — see `crmClientOnboardingAssignmentRepository.upsert()`'s own comment). Inactive/suspended staff cannot become new assignees — enforced server-side (`assertPlatformStaffMember()`), not merely by this list's own contents. */
export function OnboardingAssignments({ onboardingId, assignments, users }: { onboardingId: string; assignments: CrmClientOnboardingAssignmentWithUser[]; users: User[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function assign(role: (typeof ROLES)[number]["role"], userId: string) {
    if (userId === UNASSIGNED) return;
    setError(null);
    startTransition(async () => {
      const result = await assignOnboardingRoleAction({ onboardingId, role, userId });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {ROLES.map(({ role, label }) => {
        const current = assignments.find((a) => a.role === role);
        return (
          <div key={role} className="flex flex-col gap-1.5">
            <Label htmlFor={`onboarding-assign-${role}`}>{label}</Label>
            <Select value={current?.userId ?? UNASSIGNED} onValueChange={(v) => assign(role, v)} disabled={pending}>
              <SelectTrigger id={`onboarding-assign-${role}`} className="w-full">
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
        );
      })}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
