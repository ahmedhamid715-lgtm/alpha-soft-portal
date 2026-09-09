import "server-only";
import { z } from "zod";
import type { Invoice, Notification } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { NotFoundError } from "@/lib/errors/app-error";
import { getBillingAccount } from "@/server/services/billing-account-service";
import { getCurrentSubscriptionDetail, type CurrentSubscriptionDetail } from "@/server/services/subscription-service";
import { listInvoicesForOrganization } from "@/server/services/invoice-service";
import { resolvePortalCrmSnapshot } from "./portal-crm-bridge";
import { getPortalOnboardingStatus, type PortalOnboardingStatus } from "./portal-onboarding-service";
import { getPortalServices } from "./portal-services-service";
import { getPortalNotifications } from "./portal-notifications-service";

/**
 * The Portal home dashboard (Build 26) — a bounded composition, never a
 * loop. Resolves the customer's `CrmCompany` link AND its current
 * onboarding ONCE (`resolvePortalCrmSnapshot()`) and passes BOTH into
 * every sub-read that needs them (`getPortalOnboardingStatus`/
 * `getPortalServices`) instead of each one re-resolving them
 * independently — the redundant-composition problem Build 25's own
 * `precomputedCompany360` pattern exists to avoid, applied here one
 * level deeper after a Codex Performance Engineer finding that
 * onboarding/services were each still independently re-running the
 * SAME bounded onboarding lookup. The snapshot resolution itself also
 * now runs concurrently with every other independent read (organization/
 * billing/notifications) rather than blocking in front of them — a
 * second Codex Performance Engineer finding (the CRM bridge's own
 * elevated-transaction latency was serialized ahead of unrelated work
 * that doesn't depend on it at all). Never shows health score / churn
 * risk / sales pipeline / internal forecasts — see customer-portal.md
 * "Dashboard."
 */
export interface PortalDashboard {
  organization: { id: string; name: string; displayName: string; crmLinked: boolean };
  onboarding: PortalOnboardingStatus | null;
  servicesCount: number;
  billing: {
    canSee: boolean;
    accountStatus: string | null;
    subscription: CurrentSubscriptionDetail | null;
    latestInvoice: Pick<Invoice, "id" | "invoiceNumber" | "status" | "dueDate" | "total" | "amountDue" | "currency"> | null;
  };
  recentNotifications: Notification[];
  documentsAvailable: boolean;
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

export async function getPortalDashboard(rawInput: unknown): Promise<PortalDashboard> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("portal.access", input.organizationId);
  const userId = context.user!.id;
  const canSeeBilling = context.permissions.has("billing.read");

  const [organization, snapshot, billingAccount, subscription, invoicesPage, recentNotifications] = await Promise.all([
    withTenantContext({ userId, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) => organizationRepository.findById(input.organizationId, tx)),
    resolvePortalCrmSnapshot(input.organizationId, userId),
    canSeeBilling ? getBillingAccount(input) : Promise.resolve(null),
    canSeeBilling ? getCurrentSubscriptionDetail(input) : Promise.resolve(null),
    canSeeBilling ? listInvoicesForOrganization({ organizationId: input.organizationId, limit: 1 }) : Promise.resolve(null),
    getPortalNotifications({ organizationId: input.organizationId, limit: 5 }),
  ]);
  if (!organization) throw new NotFoundError("Organization");

  const { crmCompany, currentOnboarding } = snapshot;
  const [onboarding, services] = await Promise.all([getPortalOnboardingStatus(input, crmCompany, currentOnboarding), getPortalServices(input, crmCompany, currentOnboarding)]);

  return {
    organization: { id: organization.id, name: organization.name, displayName: organization.displayName, crmLinked: crmCompany !== null },
    onboarding,
    servicesCount: services.items.length,
    billing: {
      canSee: canSeeBilling,
      accountStatus: billingAccount?.status ?? null,
      subscription,
      latestInvoice: invoicesPage?.items[0] ?? null,
    },
    recentNotifications: recentNotifications.items,
    documentsAvailable: services.source !== "none",
  };
}
