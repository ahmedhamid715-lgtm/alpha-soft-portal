import "server-only";
import { seoPropertyRepository } from "@/server/repositories/seo-property-repository";
import { seoKeywordRepository } from "@/server/repositories/seo-keyword-repository";
import { seoRankObservationRepository } from "@/server/repositories/seo-rank-observation-repository";
import { seoIssueRepository } from "@/server/repositories/seo-issue-repository";
import { classifyFreshness, type SeoFreshness } from "@/lib/seo/freshness";
import type { TenantTransactionClient } from "@/lib/tenancy/context";
import type { CustomerService } from "@/generated/prisma/client";

/**
 * The Customer Portal's own customer-safe SEO performance projection
 * (Build 30 — Roadmap Module 24). Dedicated DTO, never the internal
 * `SeoKeyword`/`SeoIssue` model shapes — counts and one averaged number
 * only, no keyword phrases, no issue titles/notes, no staff identity,
 * no provider/source detail.
 *
 * Deliberately takes an ALREADY-OPEN Portal tenant-context `tx` rather
 * than resolving its own `seo.read` scope — a Portal customer never
 * holds a PLATFORM permission like `seo.read`, and never should; the
 * real authorization decision (`portal.access` + this organization id)
 * already happened once, in `getPortalServices()`, before this function
 * is ever called — same division of responsibility
 * `resolveCanonicalServices()` in `portal-services-service.ts` already
 * establishes for reading `CustomerService`/`ServiceDefinition` rows
 * from the Portal. See `portal-crm-bridge.ts`'s own top comment: the
 * elevated tenant context "grants nothing on its own."
 */
export interface PortalSeoPerformanceSummary {
  trackedKeywordCount: number;
  top10Count: number;
  top20Count: number;
  /** `null` when zero keywords currently have a RANKED latest observation — never a fabricated average. */
  averagePosition: number | null;
  openCriticalIssueCount: number;
  openWarningIssueCount: number;
  freshness: SeoFreshness;
}

/** `customerServices` — the SAME already-fetched `listForCustomerOrganization()` result the canonical services tier used, passed in rather than re-queried (avoids a duplicate query for data the caller already has). */
export async function getSeoPortalSummaryForCustomerServices(customerServices: CustomerService[], tx: TenantTransactionClient): Promise<PortalSeoPerformanceSummary | null> {
  const activeServiceIds = customerServices.filter((cs) => cs.status === "ACTIVE").map((cs) => cs.id);
  if (activeServiceIds.length === 0) return null;

  const definitionIds = [...new Set(customerServices.filter((cs) => activeServiceIds.includes(cs.id)).map((cs) => cs.serviceDefinitionId))];
  const definitions = await tx.serviceDefinition.findMany({ where: { id: { in: definitionIds }, category: "SEO" }, select: { id: true } });
  const seoDefinitionIds = new Set(definitions.map((d) => d.id));
  const seoServiceIds = customerServices.filter((cs) => activeServiceIds.includes(cs.id) && seoDefinitionIds.has(cs.serviceDefinitionId)).map((cs) => cs.id);
  if (seoServiceIds.length === 0) return null;

  const engagements = await tx.seoEngagement.findMany({ where: { customerServiceId: { in: seoServiceIds } }, select: { id: true } });
  if (engagements.length === 0) return null;

  const properties = await seoPropertyRepository.listForEngagements(
    engagements.map((e) => e.id),
    tx,
  );
  const activePropertyIds = properties.filter((p) => p.status === "ACTIVE").map((p) => p.id);
  if (activePropertyIds.length === 0) return null;

  const [keywords, openIssues] = await Promise.all([seoKeywordRepository.listActiveForProperties(activePropertyIds, tx), seoIssueRepository.listOpenForProperties(activePropertyIds, tx)]);
  const openCriticalIssueCount = openIssues.filter((i) => i.severity === "CRITICAL").length;
  const openWarningIssueCount = openIssues.filter((i) => i.severity === "WARNING").length;

  if (keywords.length === 0) {
    return { trackedKeywordCount: 0, top10Count: 0, top20Count: 0, averagePosition: null, openCriticalIssueCount, openWarningIssueCount, freshness: classifyFreshness(null) };
  }

  const latestTwo = await seoRankObservationRepository.listLatestTwoForKeywords(
    keywords.map((k) => k.id),
    tx,
  );
  let top10Count = 0;
  let top20Count = 0;
  let rankedPositionSum = 0;
  let rankedCount = 0;
  let lastObservedAt: Date | null = null;
  for (const obs of latestTwo) {
    if (obs.rank !== 1) continue;
    if (!lastObservedAt || obs.observedAt > lastObservedAt) lastObservedAt = obs.observedAt;
    if (obs.rankStatus !== "RANKED" || obs.position === null) continue;
    rankedPositionSum += obs.position;
    rankedCount++;
    if (obs.position <= 10) top10Count++;
    if (obs.position <= 20) top20Count++;
  }

  return {
    trackedKeywordCount: keywords.length,
    top10Count,
    top20Count,
    averagePosition: rankedCount > 0 ? Math.round((rankedPositionSum / rankedCount) * 10) / 10 : null,
    openCriticalIssueCount,
    openWarningIssueCount,
    freshness: classifyFreshness(lastObservedAt),
  };
}
