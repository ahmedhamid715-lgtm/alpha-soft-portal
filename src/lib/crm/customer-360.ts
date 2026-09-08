/**
 * Customer 360 (Build 24 — Roadmap Module 18) pure domain logic —
 * mirrors `onboarding-progress.ts`'s own "pure, isomorphic, server-
 * authoritative" discipline from Build 23. Nothing here fetches data or
 * checks authorization; `customer-360-service.ts` composes already-
 * authorized reads from the authoritative domains (CRM, Organization,
 * billing, onboarding) and hands the results here for the two things
 * that are genuinely business LOGIC, not composition: deriving the
 * customer's lifecycle stage, and merging several already-loaded
 * per-domain lists into one bounded, provenance-preserving activity
 * timeline. Kept separate from the service layer, and independently
 * unit-tested, for the same reason `onboarding-progress.ts` is.
 */

import type { CrmClientOnboardingStatus } from "@/generated/prisma/client";

// --- Lifecycle stage ---------------------------------------------------

/**
 * The six real states a `CrmCompany` can be in on its way to (and after)
 * becoming an operational customer — see `customer-360.md` "Pre-
 * conversion vs. converted." Deliberately NOT inferred from name/domain
 * heuristics; every input here is an authoritative status/timestamp
 * field already on the composed domain rows.
 */
export type CustomerLifecycleStage = "PROSPECT" | "SOLD_PENDING_ONBOARDING" | "ONBOARDING" | "CONVERTED_NO_ACTIVE_ONBOARDING" | "ACTIVE_CUSTOMER" | "ARCHIVED";

export const CUSTOMER_LIFECYCLE_STAGE_LABELS: Record<CustomerLifecycleStage, string> = {
  PROSPECT: "Prospect",
  SOLD_PENDING_ONBOARDING: "Sold — onboarding not started",
  ONBOARDING: "Onboarding",
  CONVERTED_NO_ACTIVE_ONBOARDING: "Converted — no active onboarding",
  ACTIVE_CUSTOMER: "Active customer",
  ARCHIVED: "Archived",
};

export interface LifecycleStageInput {
  companyStatus: "ACTIVE" | "ARCHIVED";
  convertedToOrganizationId: string | null;
  linkedOrganizationStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED" | null;
  /** Any WON deal, any ACCEPTED proposal, or any ACTIVE contract — the same "something was actually sold" signal `crm-client-onboarding-service.ts`'s own `resolveEligibility()` checks. */
  hasSoldSignal: boolean;
  onboardingStatuses: CrmClientOnboardingStatus[];
}

/**
 * Deliberately ordered least-to-most-authoritative — each later check can
 * override an earlier one, ending with the two lifecycle-ending states
 * (archived company, archived/suspended linked organization) as the
 * final word regardless of what commercial/onboarding history exists,
 * since those reflect the CURRENT relationship, not its history.
 */
export function deriveCustomerLifecycleStage(input: LifecycleStageInput): CustomerLifecycleStage {
  let stage: CustomerLifecycleStage = "PROSPECT";

  if (input.hasSoldSignal) stage = "SOLD_PENDING_ONBOARDING";

  const hasNonTerminalOnboarding = input.onboardingStatuses.some((s) => s === "NOT_STARTED" || s === "IN_PROGRESS" || s === "BLOCKED");
  const hasCompletedOnboarding = input.onboardingStatuses.some((s) => s === "COMPLETED");
  const hasAnyOnboarding = input.onboardingStatuses.length > 0;
  const allOnboardingsCancelled = hasAnyOnboarding && input.onboardingStatuses.every((s) => s === "CANCELLED");

  if (hasNonTerminalOnboarding) stage = "ONBOARDING";
  else if (input.convertedToOrganizationId && (allOnboardingsCancelled || !hasAnyOnboarding)) stage = "CONVERTED_NO_ACTIVE_ONBOARDING";
  if (hasCompletedOnboarding) stage = "ACTIVE_CUSTOMER";

  if (input.companyStatus === "ARCHIVED" || input.linkedOrganizationStatus === "ARCHIVED" || input.linkedOrganizationStatus === "SUSPENDED") {
    stage = "ARCHIVED";
  }

  return stage;
}

// --- Activity timeline ---------------------------------------------------

/**
 * One cross-domain timeline entry — preserves provenance (`sourceDomain`/
 * `sourceId`) the way the Build 24 authorization explicitly requires,
 * never just a bare display string. `summary` is always a short, already-
 * safe human-readable line — never a raw field dump, never audit
 * metadata (`AuditEvent` is security/compliance evidence, not customer-
 * visible business activity — see customer-360.md "Activity").
 */
export interface CustomerTimelineEntry {
  sourceDomain: "crm_activity" | "crm_deal" | "crm_proposal" | "crm_contract" | "crm_onboarding";
  sourceId: string;
  eventType: string;
  timestamp: Date;
  summary: string;
  actor?: { id: string; name: string };
  detail?: string;
}

export interface TimelineActivityInput {
  id: string;
  type: string;
  body: string | null;
  occurredAt: Date;
  actorUser: { id: string; name: string };
}
export interface TimelineDealInput {
  id: string;
  title: string;
  status: "OPEN" | "WON" | "LOST";
  createdAt: Date;
  wonAt: Date | null;
  lostAt: Date | null;
}
export interface TimelineProposalInput {
  id: string;
  proposalNumber: string;
  status: "DRAFT" | "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  createdAt: Date;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  expiredAt: Date | null;
}
export interface TimelineContractInput {
  id: string;
  contractNumber: string;
  status: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED" | "CANCELLED";
  createdAt: Date;
  activatedAt: Date | null;
  terminatedAt: Date | null;
  cancelledAt: Date | null;
}
export interface TimelineOnboardingInput {
  id: string;
  status: CrmClientOnboardingStatus;
  createdAt: Date;
  kickoffCompletedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
}

const ACTIVITY_TYPE_SUMMARY: Record<string, string> = {
  NOTE: "logged a note",
  CALL: "logged a call",
  EMAIL: "logged an email",
  MEETING: "logged a meeting",
  STATUS_CHANGE: "logged a status change",
};

/**
 * Merges already-loaded, already-authorized per-domain rows into one
 * bounded, newest-first timeline — reuses whatever the caller already
 * fetched for its own Activity/Sales/Onboarding sections rather than
 * issuing new queries (see customer-360.md "Performance"). Every entry
 * is SYNTHESIZED from a domain root's own top-level status/timestamp
 * fields (never a full history fan-out per deal/proposal/contract —
 * deliberately, to keep this composition's own query cost independent of
 * how much granular history any one deal/proposal has).
 */
export function composeCustomerTimeline(
  input: {
    activities?: TimelineActivityInput[];
    deals?: TimelineDealInput[];
    proposals?: TimelineProposalInput[];
    contracts?: TimelineContractInput[];
    onboardings?: TimelineOnboardingInput[];
  },
  limit = 50,
): CustomerTimelineEntry[] {
  const entries: CustomerTimelineEntry[] = [];

  for (const a of input.activities ?? []) {
    entries.push({
      sourceDomain: "crm_activity",
      sourceId: a.id,
      eventType: a.type,
      timestamp: a.occurredAt,
      summary: `${a.actorUser.name} ${ACTIVITY_TYPE_SUMMARY[a.type] ?? "logged an activity"}`,
      actor: a.actorUser,
      detail: a.body ?? undefined,
    });
  }

  for (const d of input.deals ?? []) {
    entries.push({ sourceDomain: "crm_deal", sourceId: d.id, eventType: "DEAL_CREATED", timestamp: d.createdAt, summary: `Deal "${d.title}" created` });
    if (d.status === "WON" && d.wonAt) entries.push({ sourceDomain: "crm_deal", sourceId: d.id, eventType: "DEAL_WON", timestamp: d.wonAt, summary: `Deal "${d.title}" won` });
    if (d.status === "LOST" && d.lostAt) entries.push({ sourceDomain: "crm_deal", sourceId: d.id, eventType: "DEAL_LOST", timestamp: d.lostAt, summary: `Deal "${d.title}" lost` });
  }

  for (const p of input.proposals ?? []) {
    entries.push({ sourceDomain: "crm_proposal", sourceId: p.id, eventType: "PROPOSAL_CREATED", timestamp: p.createdAt, summary: `Proposal ${p.proposalNumber} created` });
    if (p.acceptedAt) entries.push({ sourceDomain: "crm_proposal", sourceId: p.id, eventType: "PROPOSAL_ACCEPTED", timestamp: p.acceptedAt, summary: `Proposal ${p.proposalNumber} accepted` });
    if (p.rejectedAt) entries.push({ sourceDomain: "crm_proposal", sourceId: p.id, eventType: "PROPOSAL_REJECTED", timestamp: p.rejectedAt, summary: `Proposal ${p.proposalNumber} rejected` });
    if (p.expiredAt) entries.push({ sourceDomain: "crm_proposal", sourceId: p.id, eventType: "PROPOSAL_EXPIRED", timestamp: p.expiredAt, summary: `Proposal ${p.proposalNumber} expired` });
  }

  for (const c of input.contracts ?? []) {
    entries.push({ sourceDomain: "crm_contract", sourceId: c.id, eventType: "CONTRACT_CREATED", timestamp: c.createdAt, summary: `Contract ${c.contractNumber} created` });
    if (c.activatedAt) entries.push({ sourceDomain: "crm_contract", sourceId: c.id, eventType: "CONTRACT_ACTIVATED", timestamp: c.activatedAt, summary: `Contract ${c.contractNumber} activated` });
    if (c.terminatedAt) entries.push({ sourceDomain: "crm_contract", sourceId: c.id, eventType: "CONTRACT_TERMINATED", timestamp: c.terminatedAt, summary: `Contract ${c.contractNumber} terminated` });
    if (c.cancelledAt) entries.push({ sourceDomain: "crm_contract", sourceId: c.id, eventType: "CONTRACT_CANCELLED", timestamp: c.cancelledAt, summary: `Contract ${c.contractNumber} cancelled` });
  }

  for (const o of input.onboardings ?? []) {
    entries.push({ sourceDomain: "crm_onboarding", sourceId: o.id, eventType: "ONBOARDING_STARTED", timestamp: o.createdAt, summary: "Client onboarding started" });
    if (o.kickoffCompletedAt) entries.push({ sourceDomain: "crm_onboarding", sourceId: o.id, eventType: "ONBOARDING_KICKOFF_COMPLETED", timestamp: o.kickoffCompletedAt, summary: "Onboarding kickoff completed" });
    if (o.completedAt) entries.push({ sourceDomain: "crm_onboarding", sourceId: o.id, eventType: "ONBOARDING_COMPLETED", timestamp: o.completedAt, summary: "Onboarding completed" });
    if (o.cancelledAt) entries.push({ sourceDomain: "crm_onboarding", sourceId: o.id, eventType: "ONBOARDING_CANCELLED", timestamp: o.cancelledAt, summary: "Onboarding cancelled" });
  }

  entries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return entries.slice(0, limit);
}

// --- Documents (composed, never a generic "Document" record) ------------

export interface CustomerDocumentEntry {
  kind: "proposal" | "contract" | "onboarding_document";
  id: string;
  title: string;
  status: string;
  timestamp: Date;
  href: string;
}

// --- Raw health indicators (Build 24 boundary — see customer-360.md "Health boundary") ---

/**
 * Raw, individually-labeled factual signals only — deliberately NOT a
 * blended score, and deliberately NOT this build's own opinion about
 * whether any of them is "good" or "bad." Roadmap Module 19 (Client
 * Success, Build 25) owns turning these into an actual health score/
 * churn-risk model; this is its documented extension point.
 */
export interface CustomerRawHealthIndicators {
  lifecycleStage: CustomerLifecycleStage;
  onboardingStatus: CrmClientOnboardingStatus | null;
  onboardingProgressPercent: number | null;
  organizationStatus: "ACTIVE" | "SUSPENDED" | "ARCHIVED" | null;
  latestContractStatus: "DRAFT" | "ACTIVE" | "EXPIRED" | "TERMINATED" | "CANCELLED" | null;
  billingAccountStatus: string | null;
  subscriptionStatus: string | null;
  hasPastDueInvoice: boolean | null;
}
