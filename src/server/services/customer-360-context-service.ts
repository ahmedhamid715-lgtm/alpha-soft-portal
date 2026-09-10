import "server-only";
import { getCustomer360 } from "./customer-360-service";
import { listProjectsForCustomer360 } from "./project-customer-360-service";
import { resolvePlatformContext } from "@/lib/authorization/context";

/**
 * Customer 360 AI-context boundary (Build 24 — Roadmap Module 18,
 * critical security rule). This is NOT an AI agent and calls no model —
 * it reshapes the SAME already-authorized `Customer360ViewModel`
 * (`getCustomer360()` — same `crm.read`+per-section permission gating,
 * no wider access) into a compact, structured, provenance-preserving
 * object that a FUTURE AI module may consume as context. Every fact
 * carries its own source domain/id so a future consumer can cite or
 * re-verify it rather than trust an opaque blob.
 *
 * Explicitly does NOT: call `retrieveKnowledge()`/any embedding or LLM
 * API, expand what the requesting caller can already see (this is a
 * strict subset/reshape of `getCustomer360()`'s own output, never a
 * separate unrestricted query), or return raw billing/PII beyond what
 * `getCustomer360()` itself already exposes (payment-method numbers,
 * full addresses, etc. are never in `getCustomer360()`'s own output
 * either — see billing-platform-service.ts's own "deliberately narrow"
 * comment).
 */
export interface Customer360AiContext {
  generatedAt: string;
  company: { sourceDomain: "crm_company"; sourceId: string; name: string; status: string; lifecycleStage: string };
  linkedOrganization: { sourceDomain: "organization"; sourceId: string; name: string; status: string } | null;
  primaryContact: { sourceDomain: "crm_contact"; sourceId: string; name: string } | null;
  accountOwner: { userId: string; name: string } | null;
  sales: { openDealCount: number; wonDealCount: number; acceptedProposalCount: number; activeContractCount: number } | null;
  onboarding: { sourceDomain: "crm_onboarding"; sourceId: string; status: string; progressPercent: number | null } | null;
  billing: { billingAccountStatus: string; subscriptionStatus: string | null; hasPastDueInvoice: boolean | null } | null;
  /**
   * Build 27 — Project Management. `null` when the caller lacks
   * `delivery_projects.read` or there is no linked organization yet —
   * NEVER a widened read on this function's behalf (see this file's own
   * top comment, "never expand what the requesting caller can already
   * see"). This is authorized, structured FACTS only — no comments, no
   * attachments, no internal notes — and no model call happens here.
   * Explicitly out of scope for the Customer Portal's own AI Assistant
   * (Build 26, deliberately not CRM-aware) — that surface never calls
   * this function.
   */
  projects: { sourceDomain: "project"; sourceId: string; title: string; status: string; progressPercent: number | null; targetEndDate: string | null }[] | null;
  recentActivity: { sourceDomain: string; sourceId: string; eventType: string; summary: string; timestamp: string }[];
}

export async function getCustomer360AiContext(rawInput: { companyId: string }): Promise<Customer360AiContext> {
  const view = await getCustomer360(rawInput);

  const authContext = await resolvePlatformContext();
  const projects =
    view.linkedOrganization && authContext.permissions.has("delivery_projects.read")
      ? (await listProjectsForCustomer360(view.linkedOrganization.id))
          .slice(0, 20)
          .map((p) => ({ sourceDomain: "project" as const, sourceId: p.id, title: p.title, status: p.status, progressPercent: p.progress.kind === "MEASURED" ? p.progress.percent : null, targetEndDate: p.targetEndDate ? p.targetEndDate.toISOString() : null }))
      : null;

  return {
    generatedAt: new Date().toISOString(),
    company: { sourceDomain: "crm_company", sourceId: view.company.id, name: view.company.name, status: view.company.status, lifecycleStage: view.lifecycleStage },
    linkedOrganization: view.linkedOrganization ? { sourceDomain: "organization", sourceId: view.linkedOrganization.id, name: view.linkedOrganization.displayName, status: view.linkedOrganization.status } : null,
    primaryContact: view.primaryContact ? { sourceDomain: "crm_contact", sourceId: view.primaryContact.id, name: `${view.primaryContact.firstName} ${view.primaryContact.lastName}` } : null,
    accountOwner: view.accountOwner ? { userId: view.accountOwner.userId, name: view.accountOwner.name } : null,
    sales:
      view.deals || view.proposals || view.contracts
        ? {
            openDealCount: view.deals?.filter((d) => d.status === "OPEN").length ?? 0,
            wonDealCount: view.deals?.filter((d) => d.status === "WON").length ?? 0,
            acceptedProposalCount: view.proposals?.filter((p) => p.status === "ACCEPTED").length ?? 0,
            activeContractCount: view.contracts?.filter((c) => c.status === "ACTIVE").length ?? 0,
          }
        : null,
    onboarding: view.currentOnboardingDetail
      ? { sourceDomain: "crm_onboarding", sourceId: view.currentOnboardingDetail.onboarding.id, status: view.currentOnboardingDetail.onboarding.status, progressPercent: view.health.onboardingProgressPercent }
      : null,
    billing: view.billing ? { billingAccountStatus: view.billing.billingAccount.status, subscriptionStatus: view.billing.subscription?.status ?? null, hasPastDueInvoice: view.health.hasPastDueInvoice } : null,
    projects,
    recentActivity: view.activity.slice(0, 10).map((e) => ({ sourceDomain: e.sourceDomain, sourceId: e.sourceId, eventType: e.eventType, summary: e.summary, timestamp: e.timestamp.toISOString() })),
  };
}
