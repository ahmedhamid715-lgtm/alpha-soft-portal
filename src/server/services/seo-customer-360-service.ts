import "server-only";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveSeoScope } from "./seo-shared";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { seoPropertyRepository } from "@/server/repositories/seo-property-repository";
import { seoKeywordRepository } from "@/server/repositories/seo-keyword-repository";
import { seoRankObservationRepository } from "@/server/repositories/seo-rank-observation-repository";
import { seoIssueRepository } from "@/server/repositories/seo-issue-repository";
import type { SeoServicePerformanceInput } from "@/lib/crm/client-success";

/**
 * The ONE safe read Customer 360 / Client Success are allowed to
 * compose SEO OS data through (Build 30 — Roadmap Module 24), mirroring
 * `project-customer-360-service.ts`'s own exact "source domain owns
 * reads" discipline (Build 27). Resolves its own `seo.read` permission
 * internally — Customer 360/Client Success never escalate their own
 * caller's privileges to read SEO data they couldn't otherwise see.
 *
 * Only the customer's ACTIVE SEO `CustomerService` engagements count —
 * same "currently relevant work only" philosophy
 * `getProjectHealthInputForCustomer360()` already establishes for
 * Project Health (a PAUSED/COMPLETED/CANCELLED service's old
 * performance data shouldn't keep influencing today's classification).
 */
export async function getSeoServicePerformanceInputForCustomer360(customerOrganizationId: string): Promise<SeoServicePerformanceInput | null> {
  const { tenantScope } = await resolveSeoScope("seo.read");

  return withTenantContext(tenantScope, async (tx) => {
    const customerServices = await customerServiceRepository.listForCustomerOrganization(customerOrganizationId, tx);
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
    if (keywords.length === 0) {
      return { observedKeywordCount: 0, improvingKeywordCount: 0, decliningKeywordCount: 0, openCriticalIssueCount: openIssues.filter((i) => i.severity === "CRITICAL").length, openWarningIssueCount: openIssues.filter((i) => i.severity === "WARNING").length };
    }

    const latestTwo = await seoRankObservationRepository.listLatestTwoForKeywords(
      keywords.map((k) => k.id),
      tx,
    );
    const latestByKeyword = new Map<string, (typeof latestTwo)[number]>();
    const previousByKeyword = new Map<string, (typeof latestTwo)[number]>();
    for (const obs of latestTwo) {
      if (obs.rank === 1) latestByKeyword.set(obs.keywordId, obs);
      else if (obs.rank === 2) previousByKeyword.set(obs.keywordId, obs);
    }

    let observedKeywordCount = 0;
    let improvingKeywordCount = 0;
    let decliningKeywordCount = 0;
    for (const keyword of keywords) {
      const latest = latestByKeyword.get(keyword.id);
      if (!latest) continue;
      observedKeywordCount++;
      const previous = previousByKeyword.get(keyword.id);
      if (!previous || latest.rankStatus !== "RANKED" || previous.rankStatus !== "RANKED" || latest.position === null || previous.position === null) continue;
      // Lower position number = better rank.
      if (latest.position < previous.position) improvingKeywordCount++;
      else if (latest.position > previous.position) decliningKeywordCount++;
    }

    return {
      observedKeywordCount,
      improvingKeywordCount,
      decliningKeywordCount,
      openCriticalIssueCount: openIssues.filter((i) => i.severity === "CRITICAL").length,
      openWarningIssueCount: openIssues.filter((i) => i.severity === "WARNING").length,
    };
  });
}
