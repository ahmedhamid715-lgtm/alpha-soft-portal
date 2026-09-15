import "server-only";
import { localSeoLocationRepository } from "@/server/repositories/local-seo-location-repository";
import { localSeoKeywordRepository } from "@/server/repositories/local-seo-keyword-repository";
import { localRankObservationRepository } from "@/server/repositories/local-rank-observation-repository";
import { localSeoIssueRepository } from "@/server/repositories/local-seo-issue-repository";
import { localListingRepository } from "@/server/repositories/local-listing-repository";
import { localReviewRepository } from "@/server/repositories/local-review-repository";
import { evaluateNapConsistency } from "@/lib/local-seo/nap";
import { classifyFreshness, type SeoFreshness } from "@/lib/seo/freshness";
import type { TenantTransactionClient } from "@/lib/tenancy/context";
import type { CustomerService } from "@/generated/prisma/client";

/**
 * The Customer Portal's own customer-safe Local SEO / GBP performance
 * projection (Build 31 — Roadmap Module 25). A SEPARATE dedicated DTO
 * from `PortalSeoPerformanceSummary` — never the internal
 * `LocalSeoLocation`/`GbpProfile`/`LocalSeoKeyword`/`LocalListing`/
 * `LocalReview`/`LocalSeoIssue` model shapes. Counts and averaged
 * numbers only: no location addresses/phone/website, no keyword
 * phrases, no listing source names or observed values, no review text
 * or reviewer names, no issue titles/notes, no staff identity, no
 * provider/import/audit detail.
 *
 * Deliberately takes an ALREADY-OPEN Portal tenant-context `tx` rather
 * than resolving its own `local_seo.read` scope — mirrors
 * `getSeoPortalSummaryForCustomerServices()`'s own exact reasoning: a
 * Portal customer never holds a PLATFORM permission like
 * `local_seo.read`, and never should; the real authorization decision
 * (`portal.access` + this organization id) already happened once, in
 * `getPortalServices()`, before this function is ever called.
 */
export interface PortalLocalSeoPerformanceSummary {
  activeLocationCount: number;
  trackedKeywordCount: number;
  localPackTop3Count: number;
  localPackTop10Count: number;
  /** `null` when zero keywords currently have a RANKED latest observation — never a fabricated average. */
  averagePosition: number | null;
  openCriticalIssueCount: number;
  openWarningIssueCount: number;
  /** `null` when there are zero comparable (measurable) listings — never a fabricated 0%/100%. */
  listingConsistencyPercent: number | null;
  reviewCount: number;
  /** `null` when there are zero reviews — never a fabricated rating. */
  averageRating: number | null;
  freshness: SeoFreshness;
}

/** `customerServices` — the SAME already-fetched `listForCustomerOrganization()` result the canonical services tier used, passed in rather than re-queried. */
export async function getLocalSeoPortalSummaryForCustomerServices(customerServices: CustomerService[], tx: TenantTransactionClient): Promise<PortalLocalSeoPerformanceSummary | null> {
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

  const [keywords, openIssues, listings, reviews] = await Promise.all([
    localSeoKeywordRepository.listActiveForLocations(activeLocationIds, tx),
    localSeoIssueRepository.listOpenForLocations(activeLocationIds, tx),
    localListingRepository.listForLocations(activeLocationIds, tx),
    localReviewRepository.listForLocations(activeLocationIds, tx),
  ]);
  const openCriticalIssueCount = openIssues.filter((i) => i.severity === "CRITICAL").length;
  const openWarningIssueCount = openIssues.filter((i) => i.severity === "WARNING").length;

  const locationById = new Map(locations.map((l) => [l.id, l]));
  let listingConsistentCount = 0;
  let listingMeasurableCount = 0;
  for (const listing of listings) {
    const location = locationById.get(listing.locationId);
    if (!location) continue;
    const status = evaluateNapConsistency(
      { businessName: location.businessName, addressLine1: location.addressLine1, city: location.city, postalCode: location.postalCode, phone: location.phone },
      { observedBusinessName: listing.observedBusinessName, observedAddressLine1: listing.observedAddressLine1, observedCity: listing.observedCity, observedPostalCode: listing.observedPostalCode, observedPhone: listing.observedPhone },
    );
    if (status === "NOT_MEASURABLE") continue;
    listingMeasurableCount++;
    if (status === "CONSISTENT") listingConsistentCount++;
  }
  const listingConsistencyPercent = listingMeasurableCount > 0 ? Math.round((listingConsistentCount / listingMeasurableCount) * 1000) / 10 : null;

  const reviewCount = reviews.length;
  const averageRating = reviewCount > 0 ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10 : null;

  if (keywords.length === 0) {
    return {
      activeLocationCount: activeLocationIds.length,
      trackedKeywordCount: 0,
      localPackTop3Count: 0,
      localPackTop10Count: 0,
      averagePosition: null,
      openCriticalIssueCount,
      openWarningIssueCount,
      listingConsistencyPercent,
      reviewCount,
      averageRating,
      freshness: classifyFreshness(null),
    };
  }

  const latestTwo = await localRankObservationRepository.listLatestTwoForKeywords(
    keywords.map((k) => k.id),
    tx,
  );
  let localPackTop3Count = 0;
  let localPackTop10Count = 0;
  let rankedPositionSum = 0;
  let rankedCount = 0;
  let lastObservedAt: Date | null = null;
  for (const obs of latestTwo) {
    if (obs.rank !== 1) continue;
    if (!lastObservedAt || obs.observedAt > lastObservedAt) lastObservedAt = obs.observedAt;
    if (obs.rankStatus !== "RANKED" || obs.position === null) continue;
    rankedPositionSum += obs.position;
    rankedCount++;
    if (obs.position <= 3) localPackTop3Count++;
    if (obs.position <= 10) localPackTop10Count++;
  }

  return {
    activeLocationCount: activeLocationIds.length,
    trackedKeywordCount: keywords.length,
    localPackTop3Count,
    localPackTop10Count,
    averagePosition: rankedCount > 0 ? Math.round((rankedPositionSum / rankedCount) * 10) / 10 : null,
    openCriticalIssueCount,
    openWarningIssueCount,
    listingConsistencyPercent,
    reviewCount,
    averageRating,
    freshness: classifyFreshness(lastObservedAt),
  };
}
