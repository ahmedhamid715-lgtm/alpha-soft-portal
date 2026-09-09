import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withPortalCrmReadContext, resolvePortalCrmCompany, resolvePortalCurrentOnboarding } from "./portal-crm-bridge";
import { crmClientOnboardingServiceItemRepository } from "@/server/repositories/crm-client-onboarding-service-item-repository";
import { crmProposalRepository } from "@/server/repositories/crm-proposal-repository";
import { crmProposalVersionRepository } from "@/server/repositories/crm-proposal-version-repository";
import { crmProposalLineItemRepository } from "@/server/repositories/crm-proposal-line-item-repository";
import type { CrmCompany } from "@/generated/prisma/client";
import type { CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";

/**
 * "Purchased / onboarding services" (Build 26) — explicitly NOT a
 * Service Catalog (Roadmap Module 23 doesn't exist). Two possible real
 * sources, same precedence Customer 360's own `resolveServices()`
 * (Build 24) already established — reused here as the SAME rule, not a
 * coincidence: once onboarding has started, its own service-item
 * snapshot is the more current/operational truth; before that, the
 * accepted proposal's own line items are the only real commercial
 * record. Only customer-safe commercial fields are returned — no
 * internal discount-mechanics fields, no staff notes.
 */
export interface PortalServiceItem {
  title: string;
  description: string | null;
  quantity: number;
}

export interface PortalServices {
  source: "onboarding" | "accepted_proposal" | "none";
  items: PortalServiceItem[];
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

export async function getPortalServices(rawInput: unknown, precomputedCrmCompany?: CrmCompany | null, precomputedOnboarding?: CrmClientOnboardingWithRelations | null): Promise<PortalServices> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;

  // Codex Performance Engineer finding — same short-circuit as
  // `getPortalOnboardingStatus()`'s own identical comment.
  if (precomputedCrmCompany === null) return { source: "none", items: [] };

  return withPortalCrmReadContext(userId, async (tx) => {
    const crmCompany = precomputedCrmCompany !== undefined ? precomputedCrmCompany : await resolvePortalCrmCompany(input.organizationId, userId, tx);
    if (!crmCompany) return { source: "none", items: [] };

    const onboarding = precomputedOnboarding !== undefined ? precomputedOnboarding : await resolvePortalCurrentOnboarding(crmCompany, tx);
    if (onboarding) {
      const serviceItems = await crmClientOnboardingServiceItemRepository.listForOnboarding(onboarding.id, tx);
      if (serviceItems.length > 0) {
        return { source: "onboarding", items: serviceItems.map((s) => ({ title: s.title, description: s.description, quantity: s.quantity })) };
      }
    }

    const proposals = await crmProposalRepository.listForOrganization(crmCompany.organizationId, { companyId: crmCompany.id, status: "ACCEPTED" }, tx);
    const accepted = proposals[0] ?? null;
    if (!accepted?.currentVersionId) return { source: "none", items: [] };

    const version = await crmProposalVersionRepository.findById(accepted.currentVersionId, tx);
    if (!version) return { source: "none", items: [] };

    const lineItems = await crmProposalLineItemRepository.listForVersion(version.id, tx);
    return { source: "accepted_proposal", items: lineItems.map((li) => ({ title: li.title, description: li.description, quantity: li.quantity })) };
  });
}
