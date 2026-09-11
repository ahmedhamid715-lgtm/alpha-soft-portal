import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { resolveCrmScope } from "./crm-shared";
import { getCompany } from "./crm-company-service";
import { listContactsForCompany } from "./crm-contact-service";
import { listDeals, getDealWithRelations } from "./crm-deal-service";
import { listProposals, getProposalDetail } from "./crm-proposal-service";
import { listContracts } from "./crm-contract-service";
import { listOnboardings, getOnboardingDetail, type OnboardingDetail } from "./crm-client-onboarding-service";
import { listActivitiesForCompany } from "./crm-activity-service";
import { getOrganizationBillingForPlatform, type PlatformBillingDetail } from "./billing-platform-service";
import { listServicesForCustomer360, type Customer360ServiceSummary } from "./customer-service-service";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { BillingAccountInvalidError } from "@/lib/billing/errors";
import {
  deriveCustomerLifecycleStage,
  composeCustomerTimeline,
  type CustomerLifecycleStage,
  type CustomerTimelineEntry,
  type CustomerDocumentEntry,
  type CustomerRawHealthIndicators,
} from "@/lib/crm/customer-360";
import type { CrmCompany, CrmContact, CrmDeal, Organization } from "@/generated/prisma/client";
import type { CrmDealWithRelations } from "@/server/repositories/crm-deal-repository";
import type { CrmProposalWithRelations } from "@/server/repositories/crm-proposal-repository";
import type { CrmContractWithRelations } from "@/server/repositories/crm-contract-repository";
import type { CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";

/**
 * Customer 360 (Build 24 — Roadmap Module 18) — the ONE composition
 * layer for the cross-domain customer view. Composes already-
 * authoritative Build 19–23 domain reads (CRM, Sales, Onboarding,
 * Billing) into one view model; owns NO persistence of its own and
 * duplicates no business truth — see customer-360.md "Composition
 * architecture."
 *
 * Authorization (decision #21): the base gate is `crm.read` — the same
 * permission the existing `CrmCompany` detail page already requires,
 * since the customer identity/overview IS CRM data. Each section beyond
 * that is additionally, independently gated by ITS OWN existing
 * permission (`crm.pipeline.read`/`crm.proposal.read`/`crm.contract.read`/
 * `crm.onboarding.read`/`billing.readPlatform`) — a caller who lacks one
 * simply gets that section as `null` in the view model rather than the
 * whole page failing. No new `crm.customer_360.*` permission was created
 * — deliberate, see the doc's own "Authorization" section for why
 * `crm.read` already covers exactly what this page needs as its floor.
 *
 * Each section's own data-fetching call below reuses the EXISTING
 * granular service function for that domain (`listDeals`, `listProposals`,
 * `listOnboardings`, `getOrganizationBillingForPlatform`, ...) rather than
 * querying repositories directly — every one of those functions already
 * re-resolves its own permission/tenant context internally, the same
 * "each call independently authorizes itself" pattern
 * `admin/crm/deals/[id]/page.tsx` already establishes (see that page's
 * own multi-`Promise.all` composition). That IS a handful of repeated
 * authorization lookups per page load — reviewed and accepted as a
 * deliberate, proportionate trade-off (see customer-360.md
 * "Performance") rather than reworking five existing Build 19–23
 * services' own signatures just to shave a few in-memory permission
 * checks off an internal staff tool's own detail page.
 */

const companyIdSchema = z.object({ companyId: z.string().uuid() });

export interface Customer360ViewModel {
  company: CrmCompany;
  lifecycleStage: CustomerLifecycleStage;
  linkedOrganization: Organization | null;
  linkedOrganizationMemberCounts: Record<"ACTIVE" | "SUSPENDED" | "INVITED", number> | null;
  primaryContact: Pick<CrmContact, "id" | "firstName" | "lastName"> | null;
  accountOwner: { userId: string; name: string; source: "onboarding_assignment" | "deal" } | null;
  contacts: CrmContact[];

  canSeeSales: boolean;
  deals: CrmDeal[] | null;
  latestDeal: CrmDealWithRelations | null;
  proposals: CrmProposalWithRelations[] | null;
  contracts: CrmContractWithRelations[] | null;

  canSeeOnboarding: boolean;
  onboardings: CrmClientOnboardingWithRelations[] | null;
  currentOnboardingDetail: OnboardingDetail | null;

  canSeeServices: boolean;
  /**
   * Build 29 — real canonical `CustomerService` rows now take
   * precedence, falling back to the exact same sold/onboarding
   * snapshot precedence Build 24 originally established — see
   * service-management.md "Customer 360 integration." `"canonical"`
   * items carry richer fields (`status`/`ownerName`/dates/linked
   * projects); the two snapshot sources keep their original, narrower
   * shape (title/description/quantity only — no operational status
   * exists for a mere commercial line item).
   */
  services:
    | { source: "canonical"; items: Customer360ServiceSummary[] }
    | { source: "onboarding" | "accepted_proposal"; items: { title: string; description: string | null; quantity: number }[] }
    | null;

  canSeeBilling: boolean;
  billing: PlatformBillingDetail | null;

  documents: CustomerDocumentEntry[];
  activity: CustomerTimelineEntry[];
  health: CustomerRawHealthIndicators;
}

export async function getCustomer360(rawInput: unknown): Promise<Customer360ViewModel> {
  const input = parseOrThrow(companyIdSchema, rawInput);

  // The canonical root (decision #1) — `getCompany()` already enforces
  // `crm.read` and tenant ownership, and throws `NotFoundError` for a
  // forged/nonexistent id. Every other section below is reached ONLY
  // through this row's own fields (`id`, `convertedToOrganizationId`) —
  // never through a separately caller-supplied id (closes the
  // composition-layer IDOR class the Codex Security Engineer review
  // specifically targets).
  const company = await getCompany({ companyId: input.companyId });
  const { context } = await resolveCrmScope("crm.read");

  // Basic linked-organization identity (id/displayName/status) under
  // `crm.read` alone is consistent with Build 23's own already-shipped
  // precedent — `admin/crm/onboarding/[id]/page.tsx` already shows
  // `onboarding.linkedOrganization.displayName` to anyone with
  // `crm.onboarding.read`, not `organizations.read`; "which organization
  // did this CRM company convert to, and is it active" is legitimately
  // CRM-domain information. Membership COUNTS are a different, more
  // sensitive aggregate about the linked organization's own internal
  // state that no existing crm.* permission has ever exposed — found by
  // the Codex Security Engineer review (finding C360-01) — so that piece
  // specifically requires the organization domain's own authoritative
  // `organizations.read`, independent of `crm.read`.
  const canSeeOrganizationDetail = context.permissions.has("organizations.read");
  const canSeeSales = context.permissions.has("crm.pipeline.read");
  const canSeeProposals = context.permissions.has("crm.proposal.read");
  const canSeeContracts = context.permissions.has("crm.contract.read");
  const canSeeOnboarding = context.permissions.has("crm.onboarding.read");
  const canSeeBilling = context.permissions.has("billing.readPlatform");
  const canSeeServices = context.permissions.has("delivery_services.read");

  // Stage 1 — every one of these depends only on `company` (already
  // resolved), never on each other, so they all start together
  // (Codex Performance Engineer review, finding #1 — the linked-
  // organization lookup previously ran to completion BEFORE this batch
  // even started, serializing two genuinely independent chains).
  const [linkedOrganization, contacts, deals, proposals, contracts, onboardings, activities, canonicalServices] = await Promise.all([
    company.convertedToOrganizationId ? organizationRepository.findById(company.convertedToOrganizationId) : Promise.resolve(null),
    listContactsForCompany({ companyId: company.id }),
    canSeeSales ? listDeals({ companyId: company.id, limit: 10 }).then((r) => r.items) : Promise.resolve(null),
    canSeeProposals ? listProposals({ companyId: company.id }) : Promise.resolve(null),
    canSeeContracts ? listContracts({ companyId: company.id }) : Promise.resolve(null),
    canSeeOnboarding ? listOnboardings({ companyId: company.id }) : Promise.resolve(null),
    listActivitiesForCompany({ companyId: company.id, page: 1, limit: 25 }).then((r) => r.items),
    canSeeServices ? listServicesForCustomer360(company.id) : Promise.resolve(null),
  ]);

  // The single most-relevant deal (WON, preferentially — otherwise the
  // most recent), and the current (non-cancelled, most recent)
  // onboarding — one bounded extra call each, never a fan-out across
  // every deal/onboarding.
  const relevantDealId = deals ? (deals.find((d) => d.status === "WON") ?? deals[0])?.id : undefined;
  const currentOnboarding = onboardings?.find((o) => o.status !== "CANCELLED") ?? onboardings?.[0] ?? null;

  // Stage 2 — everything here depends on Stage 1's own output, but NOT
  // on each other (membership counts/billing depend only on
  // `linkedOrganization`; `latestDeal` only on `deals`;
  // `currentOnboardingDetail` only on `onboardings`) — same fix as
  // Stage 1, running them concurrently instead of one four-step await
  // chain.
  const [linkedOrganizationMemberCounts, billing, latestDeal, currentOnboardingDetail] = await Promise.all([
    linkedOrganization && canSeeOrganizationDetail ? organizationRepository.membershipStatusCounts(linkedOrganization.id) : Promise.resolve(null),
    canSeeBilling && linkedOrganization
      ? getOrganizationBillingForPlatform({ organizationId: linkedOrganization.id }).catch((error) => {
          if (error instanceof BillingAccountInvalidError) return null;
          throw error;
        })
      : Promise.resolve(null),
    relevantDealId ? getDealWithRelations({ dealId: relevantDealId }) : Promise.resolve(null),
    currentOnboarding && canSeeOnboarding ? getOnboardingDetail({ onboardingId: currentOnboarding.id }) : Promise.resolve(null),
  ]);

  const accountOwner = resolveAccountOwner(currentOnboardingDetail, latestDeal);
  const primaryContact = latestDeal?.primaryContact ?? null;

  const services = await resolveServices(canonicalServices, currentOnboardingDetail, proposals);
  const documents = resolveDocuments(proposals, contracts, currentOnboardingDetail);

  const hasSoldSignal = Boolean((deals && deals.some((d) => d.status === "WON")) || (proposals && proposals.some((p) => p.status === "ACCEPTED")) || (contracts && contracts.some((c) => c.status === "ACTIVE")));

  const lifecycleStage = deriveCustomerLifecycleStage({
    companyStatus: company.status,
    convertedToOrganizationId: company.convertedToOrganizationId,
    linkedOrganizationStatus: linkedOrganization?.status ?? null,
    hasSoldSignal,
    onboardingStatuses: onboardings?.map((o) => o.status) ?? [],
  });

  const activity = composeCustomerTimeline({
    activities,
    deals: deals ?? undefined,
    proposals: proposals ?? undefined,
    contracts: contracts ?? undefined,
    onboardings: onboardings?.map((o) => ({ id: o.id, status: o.status, createdAt: o.createdAt, kickoffCompletedAt: o.kickoffCompletedAt, completedAt: o.completedAt, cancelledAt: o.cancelledAt })) ?? undefined,
  });

  const latestContract = contracts?.[0] ?? null;
  const health: CustomerRawHealthIndicators = {
    lifecycleStage,
    onboardingStatus: currentOnboarding?.status ?? null,
    onboardingProgressPercent: currentOnboardingDetail?.progress.kind === "MEASURED" ? currentOnboardingDetail.progress.percent : null,
    organizationStatus: linkedOrganization?.status ?? null,
    latestContractStatus: latestContract?.status ?? null,
    billingAccountStatus: billing?.billingAccount.status ?? null,
    subscriptionStatus: billing?.subscription?.status ?? null,
    // `Invoice` has no `PAST_DUE` status of its own (see `InvoiceStatus`)
    // — an invoice is past due when it's still `OPEN`, has a `dueDate`
    // in the past, and genuinely has an amount outstanding.
    hasPastDueInvoice: billing ? billing.recentInvoices.some((i) => i.status === "OPEN" && i.dueDate !== null && i.dueDate < new Date() && i.amountDue > 0) : null,
  };

  return {
    company,
    lifecycleStage,
    linkedOrganization,
    linkedOrganizationMemberCounts,
    primaryContact,
    accountOwner,
    contacts,
    canSeeSales,
    deals,
    latestDeal,
    proposals,
    contracts,
    canSeeOnboarding,
    onboardings,
    currentOnboardingDetail,
    canSeeServices,
    services,
    canSeeBilling,
    billing,
    documents,
    activity,
    health,
  };
}

function resolveAccountOwner(onboardingDetail: OnboardingDetail | null, latestDeal: CrmDealWithRelations | null): Customer360ViewModel["accountOwner"] {
  const managerAssignment = onboardingDetail?.assignments.find((a) => a.role === "ACCOUNT_MANAGER");
  if (managerAssignment) return { userId: managerAssignment.userId, name: managerAssignment.user.name, source: "onboarding_assignment" };
  if (latestDeal?.assignedToUser) return { userId: latestDeal.assignedToUser.id, name: latestDeal.assignedToUser.name, source: "deal" };
  return null;
}

/** Onboarding service-item snapshot takes precedence once onboarding has started (it's the operational record); an accepted proposal's own line items are the fallback for a sold-but-not-yet-onboarding customer. Never both, never the future Service Management catalog. */
// `getOnboardingDetail()`'s own child collections (service items,
// documents, ...) have no cap of their own — a deliberate Build 23
// choice for its OWN dedicated single-onboarding page, where that's the
// only thing on screen. Customer 360 is the first caller that folds that
// same detail into a much larger composite page (Codex Performance
// Engineer review, finding #2) — rather than changing Build 23's own
// service/repository (which its dedicated page still needs unbounded),
// this composition applies its own output-side cap here, proportionate
// to what a tab on THIS page could ever usefully show at once.
const SERVICE_ITEMS_CAP = 50;
const DOCUMENTS_CAP = 50;

/** Build 29 — `canonicalServices` (real `CustomerService` rows) takes precedence over the original Build 24 onboarding/proposal snapshot fallback, never both, never a merge. `null` (no `delivery_services.read`, or genuinely zero canonical rows) falls through to the exact original precedence unchanged. */
async function resolveServices(canonicalServices: Customer360ServiceSummary[] | null, onboardingDetail: OnboardingDetail | null, proposals: CrmProposalWithRelations[] | null): Promise<Customer360ViewModel["services"]> {
  if (canonicalServices && canonicalServices.length > 0) {
    return { source: "canonical", items: canonicalServices };
  }
  if (onboardingDetail && onboardingDetail.serviceItems.length > 0) {
    return { source: "onboarding", items: onboardingDetail.serviceItems.slice(0, SERVICE_ITEMS_CAP).map((i) => ({ title: i.title, description: i.description, quantity: i.quantity })) };
  }
  const accepted = proposals?.find((p) => p.status === "ACCEPTED");
  if (accepted) {
    // One bounded extra call (the single accepted proposal, not a
    // fan-out across every proposal) for its own line items.
    const detail = await getProposalDetail({ proposalId: accepted.id });
    if (detail.currentVersion) {
      return { source: "accepted_proposal", items: detail.currentVersion.lineItems.slice(0, SERVICE_ITEMS_CAP).map((i) => ({ title: i.title, description: i.description, quantity: i.quantity })) };
    }
  }
  return null;
}

function resolveDocuments(proposals: CrmProposalWithRelations[] | null, contracts: CrmContractWithRelations[] | null, onboardingDetail: OnboardingDetail | null): CustomerDocumentEntry[] {
  const entries: CustomerDocumentEntry[] = [];
  for (const p of proposals ?? []) {
    if (p.status === "ACCEPTED" || p.status === "SENT") {
      entries.push({ kind: "proposal", id: p.id, title: `Proposal ${p.proposalNumber}`, status: p.status, timestamp: p.acceptedAt ?? p.createdAt, href: `/admin/crm/proposals/${p.id}` });
    }
  }
  for (const c of contracts ?? []) {
    entries.push({ kind: "contract", id: c.id, title: `Contract ${c.contractNumber}`, status: c.status, timestamp: c.activatedAt ?? c.createdAt, href: `/admin/crm/contracts/${c.id}` });
  }
  for (const d of onboardingDetail?.documents.slice(0, DOCUMENTS_CAP) ?? []) {
    entries.push({ kind: "onboarding_document", id: d.id, title: d.title, status: d.status, timestamp: d.receivedAt ?? d.createdAt, href: `/admin/crm/onboarding/${onboardingDetail!.onboarding.id}` });
  }
  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return entries.slice(0, DOCUMENTS_CAP);
}
