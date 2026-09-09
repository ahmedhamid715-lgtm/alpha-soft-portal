import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withPortalCrmReadContext, resolvePortalCrmCompany, resolvePortalCurrentOnboarding } from "./portal-crm-bridge";
import { crmClientOnboardingChecklistItemRepository } from "@/server/repositories/crm-client-onboarding-checklist-item-repository";
import { calculateProgress } from "@/lib/crm/onboarding-progress";
import type { CrmClientOnboardingStatus, CrmCompany } from "@/generated/prisma/client";
import type { CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";

/**
 * Portal-safe onboarding status (Build 26) — the aggregate ONLY.
 * Deliberately does NOT expose individual requirements/checklist items/
 * intake fields/responses: nothing in the Build 23 schema marks any of
 * those as customer-facing (no `customerVisible` flag exists anywhere
 * on `CrmClientOnboardingRequirement`/`ChecklistItem`/`IntakeField`),
 * and serializing internal, staff-authored records (assignee names, due
 * dates meant for staff, "internal readiness" flags) would cross the
 * internal/customer boundary this build exists to enforce. See
 * customer-portal.md "Onboarding visibility" — a real, honest,
 * documented limitation, not an oversight; a future build can add an
 * explicit customer-visibility flag to expose real per-item detail.
 */
export interface PortalOnboardingStatus {
  status: CrmClientOnboardingStatus;
  /** `null` when progress isn't measurable yet (no required checklist items defined) — never a fabricated number. */
  progressPercent: number | null;
  kickoffScheduledAt: Date | null;
  kickoffCompletedAt: Date | null;
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/**
 * `precomputedCrmCompany` lets a caller that already resolved the
 * customer's `CrmCompany` (the Dashboard composition) pass it straight
 * through instead of this function re-resolving it — same
 * `precomputedCompany360` pattern Build 25 established. A `null` here
 * legitimately means "no CRM link" (the caller already determined
 * that), distinct from "not supplied" (`undefined`). `precomputedOnboarding`
 * is the same idea one level deeper — the Dashboard resolves both the
 * company AND its current onboarding together
 * (`resolvePortalCrmSnapshot()`), so this function never re-runs the
 * SAME bounded onboarding lookup a second time in that case (a real
 * Codex Performance Engineer finding — this and `getPortalServices()`
 * were each independently calling `resolvePortalCurrentOnboarding()`
 * for the same request).
 */
export async function getPortalOnboardingStatus(rawInput: unknown, precomputedCrmCompany?: CrmCompany | null, precomputedOnboarding?: CrmClientOnboardingWithRelations | null): Promise<PortalOnboardingStatus | null> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;

  // Codex Performance Engineer finding — when the caller (the dashboard
  // composition) already resolved "no CRM link" for this organization,
  // opening an elevated transaction just to return `null` from inside
  // it is pure overhead. Short-circuit before ever calling
  // `withPortalCrmReadContext()`.
  if (precomputedCrmCompany === null) return null;

  return withPortalCrmReadContext(userId, async (tx) => {
    const crmCompany = precomputedCrmCompany !== undefined ? precomputedCrmCompany : await resolvePortalCrmCompany(input.organizationId, userId, tx);
    if (!crmCompany) return null;

    const current = precomputedOnboarding !== undefined ? precomputedOnboarding : await resolvePortalCurrentOnboarding(crmCompany, tx);
    if (!current) return null;

    const checklistItems = await crmClientOnboardingChecklistItemRepository.listForOnboarding(current.id, tx);
    const progress = calculateProgress(checklistItems);

    return {
      status: current.status,
      progressPercent: progress.kind === "MEASURED" ? progress.percent : null,
      kickoffScheduledAt: current.kickoffScheduledAt,
      kickoffCompletedAt: current.kickoffCompletedAt,
    };
  });
}
