import "server-only";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveLocalSeoScope } from "./local-seo-shared";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { localSeoLocationRepository } from "@/server/repositories/local-seo-location-repository";
import { localSeoKeywordRepository } from "@/server/repositories/local-seo-keyword-repository";
import { localRankObservationRepository } from "@/server/repositories/local-rank-observation-repository";
import { localSeoIssueRepository } from "@/server/repositories/local-seo-issue-repository";
import { localListingRepository } from "@/server/repositories/local-listing-repository";
import { evaluateNapConsistency } from "@/lib/local-seo/nap";
import type { LocalSeoServicePerformanceInput } from "@/lib/crm/client-success";

/**
 * The ONE safe read Customer 360 / Client Success are allowed to
 * compose Local SEO data through (Build 31 — Roadmap Module 25),
 * mirroring `seo-customer-360-service.ts`'s own exact "source domain
 * owns reads" discipline. Resolves its own `local_seo.read` permission
 * internally — Customer 360/Client Success never escalate their own
 * caller's privileges to read Local SEO data they couldn't otherwise
 * see. A SEPARATE function/domain from the SEO OS equivalent.
 *
 * Only the customer's ACTIVE Local SEO `CustomerService` engagements
 * count — same "currently relevant work only" philosophy every other
 * Customer 360 specialist input already establishes.
 */
export async function getLocalSeoServicePerformanceInputForCustomer360(customerOrganizationId: string): Promise<LocalSeoServicePerformanceInput | null> {
  const { tenantScope } = await resolveLocalSeoScope("local_seo.read");

  return withTenantContext(tenantScope, async (tx) => {
    const customerServices = await customerServiceRepository.listForCustomerOrganization(customerOrganizationId, tx);
    const activeServiceIds = customerServices.filter((cs) => cs.status === "ACTIVE").map((cs) => cs.id);
    if (activeServiceIds.length === 0) return null;

    const definitionIds = [...new Set(customerServices.filter((cs) => activeServiceIds.includes(cs.id)).map((cs) => cs.serviceDefinitionId))];
    const definitions = await tx.serviceDefinition.findMany({ where: { id: { in: definitionIds }, category: "LOCAL_SEO" }, select: { id: true } });
    const localSeoDefinitionIds = new Set(definitions.map((d) => d.id));
    const localSeoServiceIds = customerServices.filter((cs) => activeServiceIds.includes(cs.id) && localSeoDefinitionIds.has(cs.serviceDefinitionId)).map((cs) => cs.id);
    if (localSeoServiceIds.length === 0) return null;

    const engagements = await tx.localSeoEngagement.findMany({ where: { customerServiceId: { in: localSeoServiceIds } }, select: { id: true } });
    if (engagements.length === 0) return null;

    const locations = await localSeoLocationRepository.listForEngagements(
      engagements.map((e) => e.id),
      tx,
    );
    const activeLocationIds = locations.filter((l) => l.status === "ACTIVE").map((l) => l.id);
    if (activeLocationIds.length === 0) return null;

    const [keywords, openIssues, listings] = await Promise.all([
      localSeoKeywordRepository.listActiveForLocations(activeLocationIds, tx),
      localSeoIssueRepository.listOpenForLocations(activeLocationIds, tx),
      localListingRepository.listForLocations(activeLocationIds, tx),
    ]);

    const locationById = new Map(locations.map((l) => [l.id, l]));
    let inconsistentListingCount = 0;
    let measurableListingCount = 0;
    for (const listing of listings) {
      const location = locationById.get(listing.locationId);
      if (!location) continue;
      const status = evaluateNapConsistency(
        { businessName: location.businessName, addressLine1: location.addressLine1, city: location.city, postalCode: location.postalCode, phone: location.phone },
        { observedBusinessName: listing.observedBusinessName, observedAddressLine1: listing.observedAddressLine1, observedCity: listing.observedCity, observedPostalCode: listing.observedPostalCode, observedPhone: listing.observedPhone },
      );
      if (status === "NOT_MEASURABLE") continue;
      measurableListingCount++;
      if (status === "INCONSISTENT") inconsistentListingCount++;
    }

    const openCriticalIssueCount = openIssues.filter((i) => i.severity === "CRITICAL").length;
    const openWarningIssueCount = openIssues.filter((i) => i.severity === "WARNING").length;

    if (keywords.length === 0) {
      return { observedKeywordCount: 0, improvingKeywordCount: 0, decliningKeywordCount: 0, openCriticalIssueCount, openWarningIssueCount, inconsistentListingCount, measurableListingCount };
    }

    const latestTwo = await localRankObservationRepository.listLatestTwoForKeywords(
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
      if (latest.position < previous.position) improvingKeywordCount++;
      else if (latest.position > previous.position) decliningKeywordCount++;
    }

    return { observedKeywordCount, improvingKeywordCount, decliningKeywordCount, openCriticalIssueCount, openWarningIssueCount, inconsistentListingCount, measurableListingCount };
  });
}
