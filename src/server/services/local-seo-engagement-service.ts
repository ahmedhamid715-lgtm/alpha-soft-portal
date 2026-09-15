import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveLocalSeoScope } from "./local-seo-shared";
import { localSeoEngagementRepository } from "@/server/repositories/local-seo-engagement-repository";
import { localSeoLocationRepository } from "@/server/repositories/local-seo-location-repository";
import { gbpProfileRepository } from "@/server/repositories/gbp-profile-repository";
import { localSeoKeywordRepository, type LocalSeoKeywordListFilters } from "@/server/repositories/local-seo-keyword-repository";
import { localRankObservationRepository } from "@/server/repositories/local-rank-observation-repository";
import { localListingRepository } from "@/server/repositories/local-listing-repository";
import { localReviewRepository } from "@/server/repositories/local-review-repository";
import { localSeoIssueRepository } from "@/server/repositories/local-seo-issue-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { normalizePropertyUrl, InvalidPropertyUrlError } from "@/lib/seo/property-url";
import { normalizeKeywordPhrase } from "@/lib/seo/keyword-normalization";
import { classifyFreshness, type SeoFreshness } from "@/lib/seo/freshness";
import { evaluateNapConsistency, type NapConsistencyStatus } from "@/lib/local-seo/nap";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { LocalSeoEngagement, LocalSeoLocation, GbpProfile, LocalSeoKeyword, CustomerService } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginatedResult, OffsetPaginationParams } from "@/lib/platform/pagination";

/**
 * `z.string().url()` alone accepts any URL scheme, including
 * `javascript:`/`data:` — Codex Security Engineer finding LS-SEC-03
 * (Build 31 security review): `GbpProfile.profileUrl` is rendered
 * directly into an anchor `href` (`profile-tab.tsx`); React 19
 * currently blocks a `javascript:` href at render time, but the
 * server-side invariant should not depend on that runtime behavior.
 * Same http/https-only enforcement `normalizePropertyUrl()` and the
 * CSV parser's own `isValidHttpUrl()` already apply elsewhere in this
 * codebase — mirrored here as a Zod refinement.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Local SEO / GBP engagement, location, GBP profile, and keyword
 * management (Build 31 — Roadmap Module 25) — the specialist layer
 * attached to exactly one `CustomerService` whose `ServiceDefinition.
 * category = LOCAL_SEO`. A SEPARATE specialist domain from SEO OS — see
 * docs/architecture/gbp-local-seo.md for the full architecture writeup.
 * `local_seo.manage` for structural mutations (engagement/location/
 * profile/keyword create/archive); `local_seo.read` for listing/detail.
 */

async function assertEligibleLocalSeoCustomerService(customerServiceId: string, organizationId: string, tx: TransactionClient): Promise<CustomerService> {
  const customerService = await customerServiceRepository.findById(customerServiceId, tx);
  if (!customerService || customerService.organizationId !== organizationId) throw new NotFoundError("Customer service");
  // Never trust a client-supplied id — re-verify the category server-side
  // even though the DB trigger will ALSO reject a mismatch on insert
  // (a SEPARATE trigger from SEO OS's own — see the migration). This
  // gives a clean, specific error instead of a raw constraint violation.
  const definition = await tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { category: true } });
  if (!definition || definition.category !== "LOCAL_SEO") {
    throw new ValidationError("This customer service does not use a Local SEO service definition — a Local SEO engagement can only attach to a service whose category is LOCAL_SEO.");
  }
  return customerService;
}

// --- Engagement list ------------------------------------------------------

export interface LocalSeoEngagementListItem {
  engagement: LocalSeoEngagement;
  companyName: string;
  serviceName: string;
  customerServiceStatus: string;
  locationCount: number;
}

/** Every Local SEO engagement, bounded to 200 — same realistic-total assumption `listSeoEngagements()` documents. */
export async function listLocalSeoEngagements(): Promise<LocalSeoEngagementListItem[]> {
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const engagements = await tx.localSeoEngagement.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
    if (engagements.length === 0) return [];

    const customerServiceIds = engagements.map((e) => e.customerServiceId);
    const customerServices = await tx.customerService.findMany({ where: { id: { in: customerServiceIds } }, select: { id: true, status: true, companyId: true, serviceDefinitionId: true } });
    const customerServiceById = new Map(customerServices.map((cs) => [cs.id, cs]));
    const companyIds = [...new Set(customerServices.map((cs) => cs.companyId))];
    const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
    const [companies, definitions, locationCounts] = await Promise.all([
      tx.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true } }),
      tx.localSeoLocation.groupBy({ by: ["engagementId"], where: { engagementId: { in: engagements.map((e) => e.id) } }, _count: { id: true } }),
    ]);
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
    const definitionNameById = new Map(definitions.map((d) => [d.id, d.name]));
    const locationCountByEngagement = new Map(locationCounts.map((p) => [p.engagementId, p._count.id]));

    return engagements.map((engagement) => {
      const cs = customerServiceById.get(engagement.customerServiceId);
      return {
        engagement,
        companyName: cs ? (companyNameById.get(cs.companyId) ?? "Customer") : "Customer",
        serviceName: cs ? (definitionNameById.get(cs.serviceDefinitionId) ?? "Local SEO") : "Local SEO",
        customerServiceStatus: cs?.status ?? "UNKNOWN",
        locationCount: locationCountByEngagement.get(engagement.id) ?? 0,
      };
    });
  });
}

// --- Engagement -----------------------------------------------------------

const createEngagementSchema = z.object({ customerServiceId: z.string().uuid() });

/** Idempotent — a repeat call for the same `customerServiceId` returns the existing engagement, same pattern `createSeoEngagement()` establishes. */
export async function createLocalSeoEngagement(rawInput: unknown): Promise<LocalSeoEngagement> {
  const input = parseOrThrow(createEngagementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");

  const { engagement, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await localSeoEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx);
    if (existing) return { engagement: existing, wasCreated: false };

    await assertEligibleLocalSeoCustomerService(input.customerServiceId, organizationId, tx);
    const created = await localSeoEngagementRepository.create({ id: generateId(), organizationId, customerServiceId: input.customerServiceId, createdByUserId: context.user!.id }, tx);
    return { engagement: created, wasCreated: true };
  });

  if (wasCreated) {
    await audit
      .recordSuccess({ action: "localseo.engagement_created", organizationId, resourceType: "local_seo_engagement", resourceId: engagement.id, resourceName: "Local SEO engagement", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record localseo.engagement_created", error));
  }
  return engagement;
}

const engagementIdSchema = z.object({ engagementId: z.string().uuid() });

export async function getLocalSeoEngagement(rawInput: unknown): Promise<LocalSeoEngagement> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  const engagement = await withTenantContext(tenantScope, (tx) => localSeoEngagementRepository.findById(input.engagementId, tx));
  if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Local SEO engagement");
  return engagement;
}

const customerServiceIdSchema = z.object({ customerServiceId: z.string().uuid() });

/** `null` (never throws) when no engagement exists yet — callers (the CustomerService detail page's "Set up Local SEO workspace" affordance) branch on this. */
export async function getLocalSeoEngagementByCustomerService(rawInput: unknown): Promise<LocalSeoEngagement | null> {
  const input = parseOrThrow(customerServiceIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  const engagement = await withTenantContext(tenantScope, (tx) => localSeoEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx));
  if (!engagement || engagement.organizationId !== organizationId) return null;
  return engagement;
}

export interface LocalSeoLocationSummary {
  location: LocalSeoLocation;
  gbpProfile: GbpProfile | null;
  keywordCount: number;
  freshness: SeoFreshness;
  lastObservedAt: Date | null;
  openIssueCount: number;
  listingCount: number;
}

export interface LocalSeoEngagementDetail {
  engagement: LocalSeoEngagement;
  customerServiceId: string;
  companyName: string;
  serviceName: string;
  locations: LocalSeoLocationSummary[];
}

/**
 * The engagement workspace's own enriched read — bounded batch, never
 * one query per location. Resolves `local_seo.read` exactly ONCE
 * (Codex Performance Engineer finding PERF-03 — the original version
 * called `getLocalSeoEngagement()`, which resolves scope internally,
 * and then resolved scope AGAIN here).
 */
export async function getLocalSeoEngagementDetail(rawInput: unknown): Promise<LocalSeoEngagementDetail> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");

  return withTenantContext(tenantScope, async (tx) => {
    const engagement = await localSeoEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Local SEO engagement");

    const [customerService, locations] = await Promise.all([
      tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, serviceDefinitionId: true } }),
      localSeoLocationRepository.listForEngagement(engagement.id, tx),
    ]);
    const [company, definition] = await Promise.all([
      customerService ? tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : Promise.resolve(null),
      customerService ? tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    const locationIds = locations.map((l) => l.id);
    const [gbpProfiles, keywords, issues, listings] = await Promise.all([
      gbpProfileRepository.listForLocations(locationIds, tx),
      localSeoKeywordRepository.listActiveForLocations(locationIds, tx),
      localSeoIssueRepository.listOpenForLocations(locationIds, tx),
      localListingRepository.listForLocations(locationIds, tx),
    ]);
    const gbpProfileByLocation = new Map(gbpProfiles.map((p) => [p.locationId, p]));
    const keywordsByLocation = new Map<string, typeof keywords>();
    for (const k of keywords) keywordsByLocation.set(k.locationId, [...(keywordsByLocation.get(k.locationId) ?? []), k]);
    const openIssuesByLocation = new Map<string, number>();
    for (const i of issues) openIssuesByLocation.set(i.locationId, (openIssuesByLocation.get(i.locationId) ?? 0) + 1);
    const listingCountByLocation = new Map<string, number>();
    for (const l of listings) listingCountByLocation.set(l.locationId, (listingCountByLocation.get(l.locationId) ?? 0) + 1);

    const keywordIds = keywords.map((k) => k.id);
    const latestObservations = await localRankObservationRepository.listLatestTwoForKeywords(keywordIds, tx);
    const latestByKeyword = new Map<string, Date>();
    for (const obs of latestObservations) {
      if (obs.rank === 1) latestByKeyword.set(obs.keywordId, obs.observedAt);
    }

    const locationSummaries: LocalSeoLocationSummary[] = locations.map((location) => {
      const locKeywords = keywordsByLocation.get(location.id) ?? [];
      const locLastObserved = locKeywords.reduce<Date | null>((latest, k) => {
        const d = latestByKeyword.get(k.id);
        if (!d) return latest;
        return !latest || d > latest ? d : latest;
      }, null);
      return {
        location,
        gbpProfile: gbpProfileByLocation.get(location.id) ?? null,
        keywordCount: locKeywords.length,
        freshness: classifyFreshness(locLastObserved),
        lastObservedAt: locLastObserved,
        openIssueCount: openIssuesByLocation.get(location.id) ?? 0,
        listingCount: listingCountByLocation.get(location.id) ?? 0,
      };
    });

    return {
      engagement,
      customerServiceId: engagement.customerServiceId,
      companyName: company?.name ?? "Customer",
      serviceName: definition?.name ?? "Local SEO",
      locations: locationSummaries,
    };
  });
}

// --- Locations -------------------------------------------------------------

const createLocationSchema = z.object({
  engagementId: z.string().uuid(),
  businessName: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(30).nullable().optional(),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  websiteUrl: z.string().trim().max(2048).nullable().optional(),
  serviceAreaBusiness: z.boolean().default(false),
});

/** Service Area Businesses legitimately have no public address — every address field stays nullable and is never fabricated (decision: "Service Area Business", master prompt). */
export async function createLocalSeoLocation(rawInput: unknown): Promise<LocalSeoLocation> {
  const input = parseOrThrow(createLocationSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");

  let normalizedWebsiteOrigin: string | null = null;
  if (input.websiteUrl) {
    try {
      normalizedWebsiteOrigin = normalizePropertyUrl(input.websiteUrl).normalizedOrigin;
    } catch (error) {
      if (error instanceof InvalidPropertyUrlError) throw new ValidationError(error.message);
      throw error;
    }
  }

  const location = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await localSeoEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("Local SEO engagement");

    return localSeoLocationRepository.create(
      {
        id: generateId(),
        organizationId,
        engagementId: input.engagementId,
        businessName: input.businessName,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country ?? null,
        phone: input.phone ?? null,
        websiteUrl: input.websiteUrl ?? null,
        normalizedWebsiteOrigin,
        serviceAreaBusiness: input.serviceAreaBusiness,
        source: "MANUAL",
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "localseo.location_added", organizationId, resourceType: "local_seo_location", resourceId: location.id, resourceName: location.businessName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.location_added", error));
  return location;
}

const locationIdSchema = z.object({ locationId: z.string().uuid() });

export async function loadLocalSeoLocationChecked(locationId: string, organizationId: string, tx: TransactionClient): Promise<LocalSeoLocation> {
  const location = await localSeoLocationRepository.findById(locationId, tx);
  if (!location || location.organizationId !== organizationId) throw new NotFoundError("Local SEO location");
  return location;
}

const updateLocationSchema = z.object({
  locationId: z.string().uuid(),
  businessName: z.string().trim().min(1).max(200).optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  postalCode: z.string().trim().max(30).nullable().optional(),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  websiteUrl: z.string().trim().max(2048).nullable().optional(),
  serviceAreaBusiness: z.boolean().optional(),
});

export async function updateLocalSeoLocation(rawInput: unknown): Promise<LocalSeoLocation> {
  const input = parseOrThrow(updateLocationSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");

  let normalizedWebsiteOrigin: string | null | undefined;
  if (input.websiteUrl !== undefined) {
    if (input.websiteUrl === null) {
      normalizedWebsiteOrigin = null;
    } else {
      try {
        normalizedWebsiteOrigin = normalizePropertyUrl(input.websiteUrl).normalizedOrigin;
      } catch (error) {
        if (error instanceof InvalidPropertyUrlError) throw new ValidationError(error.message);
        throw error;
      }
    }
  }

  const { locationId, ...rest } = input;
  const location = await withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(locationId, organizationId, tx);
    return localSeoLocationRepository.update(locationId, { ...rest, ...(normalizedWebsiteOrigin !== undefined ? { normalizedWebsiteOrigin } : {}) }, tx);
  });

  await audit
    .recordSuccess({ action: "localseo.location_updated", organizationId, resourceType: "local_seo_location", resourceId: location.id, resourceName: location.businessName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.location_updated", error));
  return location;
}

export async function archiveLocalSeoLocation(rawInput: unknown): Promise<LocalSeoLocation> {
  const input = parseOrThrow(locationIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");
  const location = await withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    const updated = await localSeoLocationRepository.archive(input.locationId, tx);
    if (!updated) throw new ConflictError("This location was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.location_archived", organizationId, resourceType: "local_seo_location", resourceId: location.id, resourceName: location.businessName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.location_archived", error));
  return location;
}

export async function reactivateLocalSeoLocation(rawInput: unknown): Promise<LocalSeoLocation> {
  const input = parseOrThrow(locationIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");
  const location = await withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    const updated = await localSeoLocationRepository.reactivate(input.locationId, tx);
    if (!updated) throw new ConflictError("This location was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.location_reactivated", organizationId, resourceType: "local_seo_location", resourceId: location.id, resourceName: location.businessName, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.location_reactivated", error));
  return location;
}

// --- GBP profile -------------------------------------------------------------

const recordGbpProfileSchema = z.object({
  locationId: z.string().uuid(),
  externalProfileId: z.string().trim().max(200).nullable().optional(),
  profileUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine(isHttpUrl, "profileUrl must use http:// or https://")
    .nullable()
    .optional(),
  primaryCategory: z.string().trim().max(120).nullable().optional(),
  secondaryCategories: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  verificationState: z.enum(["VERIFIED", "UNVERIFIED", "NOT_MEASURED"]).default("NOT_MEASURED"),
  observedStatus: z.string().trim().max(120).nullable().optional(),
  lastObservedAt: z.coerce.date().nullable().optional(),
});

/**
 * Insert-or-update on the location's one-and-only GBP profile row (real
 * UNIQUE on `locationId`) — staff record or re-record what was actually
 * observed. `verificationState`/`observedStatus` reflect an OBSERVATION,
 * never a live API call — never silently upgraded to VERIFIED without an
 * explicit input value (decision: "GBP Profile model").
 */
export async function recordGbpProfile(rawInput: unknown): Promise<GbpProfile> {
  const input = parseOrThrow(recordGbpProfileSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");

  const { profile, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    const existing = await gbpProfileRepository.findByLocationId(input.locationId, tx);
    const data = {
      externalProfileId: input.externalProfileId ?? null,
      profileUrl: input.profileUrl ?? null,
      primaryCategory: input.primaryCategory ?? null,
      secondaryCategories: input.secondaryCategories,
      verificationState: input.verificationState,
      observedStatus: input.observedStatus ?? null,
      lastObservedAt: input.lastObservedAt ?? null,
      source: "MANUAL" as const,
    };
    if (existing) {
      const updated = await gbpProfileRepository.update(existing.id, data, tx);
      return { profile: updated, wasCreated: false };
    }
    const created = await gbpProfileRepository.create({ id: generateId(), organizationId, locationId: input.locationId, createdByUserId: context.user!.id, ...data }, tx);
    return { profile: created, wasCreated: true };
  });

  await audit
    .recordSuccess({
      action: wasCreated ? "localseo.gbp_profile_recorded" : "localseo.gbp_profile_updated",
      organizationId,
      resourceType: "gbp_profile",
      resourceId: profile.id,
      resourceName: profile.externalProfileId ?? profile.id,
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record localseo.gbp_profile_recorded", error));
  return profile;
}

// --- Keywords -----------------------------------------------------------

const createKeywordSchema = z.object({
  locationId: z.string().uuid(),
  phrase: z.string().trim().min(1).max(200),
  device: z.enum(["DESKTOP", "MOBILE"]),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  locale: z.string().min(2).max(35).nullable().optional(),
  searchLat: z.coerce.number().min(-90).max(90).nullable().optional(),
  searchLng: z.coerce.number().min(-180).max(180).nullable().optional(),
  searchLabel: z.string().trim().max(120).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export async function createLocalSeoKeyword(rawInput: unknown): Promise<LocalSeoKeyword> {
  const input = parseOrThrow(createKeywordSchema, rawInput);
  if ((input.searchLat === null || input.searchLat === undefined) !== (input.searchLng === null || input.searchLng === undefined)) {
    throw new ValidationError("searchLat and searchLng must be provided together, or both omitted.");
  }
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");
  const normalizedPhrase = normalizeKeywordPhrase(input.phrase);
  const searchSurface = "LOCAL_PACK" as const;

  const keyword = await withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    const existing = await localSeoKeywordRepository.findByDedupKey(
      { locationId: input.locationId, normalizedPhrase, searchSurface, device: input.device, country: input.country ?? null, locale: input.locale ?? null, searchLabel: input.searchLabel ?? null },
      tx,
    );
    if (existing) throw new ConflictError(`"${input.phrase}" is already tracked for this location/device/search-point combination.`);

    return localSeoKeywordRepository.create(
      {
        id: generateId(),
        organizationId,
        locationId: input.locationId,
        phrase: input.phrase.trim(),
        normalizedPhrase,
        searchSurface,
        device: input.device,
        country: input.country ?? null,
        locale: input.locale ?? null,
        searchLat: input.searchLat ?? null,
        searchLng: input.searchLng ?? null,
        searchLabel: input.searchLabel ?? null,
        tags: input.tags,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "localseo.keyword_added", organizationId, resourceType: "local_seo_keyword", resourceId: keyword.id, resourceName: keyword.phrase, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.keyword_added", error));
  return keyword;
}

const keywordIdSchema = z.object({ keywordId: z.string().uuid() });

async function loadKeywordChecked(keywordId: string, organizationId: string, tx: TransactionClient): Promise<LocalSeoKeyword> {
  const keyword = await localSeoKeywordRepository.findById(keywordId, tx);
  if (!keyword || keyword.organizationId !== organizationId) throw new NotFoundError("Local SEO keyword");
  return keyword;
}

export async function archiveLocalSeoKeyword(rawInput: unknown): Promise<LocalSeoKeyword> {
  const input = parseOrThrow(keywordIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");
  const keyword = await withTenantContext(tenantScope, async (tx) => {
    await loadKeywordChecked(input.keywordId, organizationId, tx);
    const updated = await localSeoKeywordRepository.archive(input.keywordId, tx);
    if (!updated) throw new ConflictError("This keyword was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.keyword_archived", organizationId, resourceType: "local_seo_keyword", resourceId: keyword.id, resourceName: keyword.phrase, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.keyword_archived", error));
  return keyword;
}

export async function reactivateLocalSeoKeyword(rawInput: unknown): Promise<LocalSeoKeyword> {
  const input = parseOrThrow(keywordIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.manage");
  const keyword = await withTenantContext(tenantScope, async (tx) => {
    await loadKeywordChecked(input.keywordId, organizationId, tx);
    const updated = await localSeoKeywordRepository.reactivate(input.keywordId, tx);
    if (!updated) throw new ConflictError("This keyword was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "localseo.keyword_reactivated", organizationId, resourceType: "local_seo_keyword", resourceId: keyword.id, resourceName: keyword.phrase, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record localseo.keyword_reactivated", error));
  return keyword;
}

const listKeywordsSchema = z.object({
  locationId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export interface LocalSeoKeywordListItem extends LocalSeoKeyword {
  currentPosition: number | null;
  currentRankStatus: string | null;
  currentObservedAt: Date | null;
  previousPosition: number | null;
}

export async function listLocalSeoKeywords(rawInput: unknown): Promise<OffsetPaginatedResult<LocalSeoKeywordListItem>> {
  const input = parseOrThrow(listKeywordsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: LocalSeoKeywordListFilters = { status: input.status, search: input.search };

  return withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    const page = await localSeoKeywordRepository.listForLocation(input.locationId, params, filters, tx);
    if (page.items.length === 0) return { items: [], pageInfo: page.pageInfo };

    const observations = await localRankObservationRepository.listLatestTwoForKeywords(page.items.map((k) => k.id), tx);
    const latestByKeyword = new Map<string, (typeof observations)[number]>();
    const previousByKeyword = new Map<string, (typeof observations)[number]>();
    for (const obs of observations) {
      if (obs.rank === 1) latestByKeyword.set(obs.keywordId, obs);
      else if (obs.rank === 2) previousByKeyword.set(obs.keywordId, obs);
    }

    const items = page.items.map((k) => {
      const latest = latestByKeyword.get(k.id);
      const previous = previousByKeyword.get(k.id);
      return { ...k, currentPosition: latest?.position ?? null, currentRankStatus: latest?.rankStatus ?? null, currentObservedAt: latest?.observedAt ?? null, previousPosition: previous?.position ?? null };
    });
    return { items, pageInfo: page.pageInfo };
  });
}

export async function getGbpProfileForLocation(rawInput: unknown): Promise<GbpProfile | null> {
  const input = parseOrThrow(locationIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    return gbpProfileRepository.findByLocationId(input.locationId, tx);
  });
}

// --- Location KPI overview ---------------------------------------------------

export interface LocalSeoLocationKpis {
  trackedKeywordCount: number;
  observedKeywordCount: number;
  localPackTop3Count: number;
  localPackTop10Count: number;
  averagePosition: number | null;
  improvingCount: number;
  decliningCount: number;
  openIssueCounts: { critical: number; warning: number; info: number };
  freshness: SeoFreshness;
  lastObservedAt: Date | null;
  listingCount: number;
  listingConsistentCount: number;
  listingInconsistentCount: number;
  listingConsistencyPercent: number | null;
  reviewCount: number;
  averageRating: number | null;
}

/**
 * KPI formulas (see docs/architecture/gbp-local-seo.md "KPI formulas"):
 * mirrors `getSeoPropertyOverview()`'s own exact keyword-KPI discipline
 * (real persisted rows only, `RANKED`-latest only counted toward
 * position/top-N, never coerced). Listing consistency and review metrics
 * are Local SEO's own additions — a zero-denominator case always yields
 * `null` (NOT_MEASURABLE), never a fabricated 0% or 100%.
 */
export async function getLocalSeoLocationOverview(rawInput: unknown): Promise<{ location: LocalSeoLocation; engagementId: string; kpis: LocalSeoLocationKpis }> {
  const input = parseOrThrow(locationIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveLocalSeoScope("local_seo.read");

  return withTenantContext(tenantScope, async (tx) => {
    const location = await loadLocalSeoLocationChecked(input.locationId, organizationId, tx);
    const [keywords, openIssues, listings, reviews] = await Promise.all([
      localSeoKeywordRepository.listActiveForLocation(input.locationId, tx),
      localSeoIssueRepository.listOpenForLocations([input.locationId], tx),
      localListingRepository.listForLocation(input.locationId, tx),
      localReviewRepository.listForLocations([input.locationId], tx),
    ]);

    const openIssueCounts = { critical: openIssues.filter((i) => i.severity === "CRITICAL").length, warning: openIssues.filter((i) => i.severity === "WARNING").length, info: openIssues.filter((i) => i.severity === "INFO").length };

    let listingConsistentCount = 0;
    let listingInconsistentCount = 0;
    let listingMeasurableCount = 0;
    for (const listing of listings) {
      const status: NapConsistencyStatus = evaluateNapConsistency(
        { businessName: location.businessName, addressLine1: location.addressLine1, city: location.city, postalCode: location.postalCode, phone: location.phone },
        { observedBusinessName: listing.observedBusinessName, observedAddressLine1: listing.observedAddressLine1, observedCity: listing.observedCity, observedPostalCode: listing.observedPostalCode, observedPhone: listing.observedPhone },
      );
      if (status === "NOT_MEASURABLE") continue;
      listingMeasurableCount++;
      if (status === "CONSISTENT") listingConsistentCount++;
      else if (status === "INCONSISTENT") listingInconsistentCount++;
    }

    const reviewCount = reviews.length;
    const averageRating = reviewCount > 0 ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount) * 10) / 10 : null;

    if (keywords.length === 0) {
      return {
        location,
        engagementId: location.engagementId,
        kpis: {
          trackedKeywordCount: 0,
          observedKeywordCount: 0,
          localPackTop3Count: 0,
          localPackTop10Count: 0,
          averagePosition: null,
          improvingCount: 0,
          decliningCount: 0,
          openIssueCounts,
          freshness: classifyFreshness(null),
          lastObservedAt: null,
          listingCount: listings.length,
          listingConsistentCount,
          listingInconsistentCount,
          listingConsistencyPercent: listingMeasurableCount > 0 ? Math.round((listingConsistentCount / listingMeasurableCount) * 1000) / 10 : null,
          reviewCount,
          averageRating,
        },
      };
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
    let localPackTop3Count = 0;
    let localPackTop10Count = 0;
    let positionSum = 0;
    let rankedCount = 0;
    let improvingCount = 0;
    let decliningCount = 0;
    let lastObservedAt: Date | null = null;

    for (const keyword of keywords) {
      const latest = latestByKeyword.get(keyword.id);
      if (!latest) continue;
      observedKeywordCount++;
      if (!lastObservedAt || latest.observedAt > lastObservedAt) lastObservedAt = latest.observedAt;
      if (latest.rankStatus === "RANKED" && latest.position !== null) {
        positionSum += latest.position;
        rankedCount++;
        if (latest.position <= 3) localPackTop3Count++;
        if (latest.position <= 10) localPackTop10Count++;
      }
      const previous = previousByKeyword.get(keyword.id);
      if (previous && latest.rankStatus === "RANKED" && previous.rankStatus === "RANKED" && latest.position !== null && previous.position !== null) {
        if (latest.position < previous.position) improvingCount++;
        else if (latest.position > previous.position) decliningCount++;
      }
    }

    return {
      location,
      engagementId: location.engagementId,
      kpis: {
        trackedKeywordCount: keywords.length,
        observedKeywordCount,
        localPackTop3Count,
        localPackTop10Count,
        averagePosition: rankedCount > 0 ? Math.round((positionSum / rankedCount) * 10) / 10 : null,
        improvingCount,
        decliningCount,
        openIssueCounts,
        freshness: classifyFreshness(lastObservedAt),
        lastObservedAt,
        listingCount: listings.length,
        listingConsistentCount,
        listingInconsistentCount,
        listingConsistencyPercent: listingMeasurableCount > 0 ? Math.round((listingConsistentCount / listingMeasurableCount) * 1000) / 10 : null,
        reviewCount,
        averageRating,
      },
    };
  });
}
