import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveSeoScope } from "./seo-shared";
import { seoEngagementRepository } from "@/server/repositories/seo-engagement-repository";
import { seoPropertyRepository } from "@/server/repositories/seo-property-repository";
import { seoKeywordRepository, type SeoKeywordListFilters } from "@/server/repositories/seo-keyword-repository";
import { seoRankObservationRepository } from "@/server/repositories/seo-rank-observation-repository";
import { seoIssueRepository } from "@/server/repositories/seo-issue-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { normalizePropertyUrl, urlBelongsToOrigin, InvalidPropertyUrlError } from "@/lib/seo/property-url";
import { normalizeKeywordPhrase } from "@/lib/seo/keyword-normalization";
import { classifyFreshness, type SeoFreshness } from "@/lib/seo/freshness";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { SeoEngagement, SeoProperty, SeoKeyword, SeoSearchEngine, SeoDevice, CustomerService } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";
import type { OffsetPaginatedResult, OffsetPaginationParams } from "@/lib/platform/pagination";

/**
 * SEO OS engagement/property/keyword management (Build 30 — Roadmap
 * Module 24) — the specialist layer attached to exactly one
 * `CustomerService` whose `ServiceDefinition.category = SEO`. See
 * docs/architecture/seo-os.md for the full architecture writeup.
 * `seo.manage` for structural mutations (engagement/property/keyword
 * create/archive); `seo.read` for listing/detail.
 */

async function assertEligibleSeoCustomerService(customerServiceId: string, organizationId: string, tx: TransactionClient): Promise<CustomerService> {
  const customerService = await customerServiceRepository.findById(customerServiceId, tx);
  if (!customerService || customerService.organizationId !== organizationId) throw new NotFoundError("Customer service");
  // Never trust a client-supplied id — re-verify the category server-side
  // even though the DB trigger will ALSO reject a mismatch on insert;
  // this gives a clean, specific error instead of a raw constraint
  // violation, same defense-in-depth style Build 29's own
  // `assertActiveServiceDefinition()` establishes.
  const definition = await tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { category: true } });
  if (!definition || definition.category !== "SEO") {
    throw new ValidationError("This customer service does not use an SEO service definition — an SEO engagement can only attach to a service whose category is SEO.");
  }
  return customerService;
}

// --- Engagement list ------------------------------------------------------

export interface SeoEngagementListItem {
  engagement: SeoEngagement;
  companyName: string;
  serviceName: string;
  customerServiceStatus: string;
  propertyCount: number;
}

/** Every SEO engagement, bounded to 200 — the same realistic-total assumption `serviceDefinitionRepository.listAll()` documents (a real agency tracks dozens of active engagements, not thousands). */
export async function listSeoEngagements(): Promise<SeoEngagementListItem[]> {
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");
  return withTenantContext(tenantScope, async (tx) => {
    const engagements = await tx.seoEngagement.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 200 });
    if (engagements.length === 0) return [];

    const customerServiceIds = engagements.map((e) => e.customerServiceId);
    const customerServices = await tx.customerService.findMany({ where: { id: { in: customerServiceIds } }, select: { id: true, status: true, companyId: true, serviceDefinitionId: true } });
    const customerServiceById = new Map(customerServices.map((cs) => [cs.id, cs]));
    const companyIds = [...new Set(customerServices.map((cs) => cs.companyId))];
    const definitionIds = [...new Set(customerServices.map((cs) => cs.serviceDefinitionId))];
    const [companies, definitions, propertyCounts] = await Promise.all([
      tx.crmCompany.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }),
      tx.serviceDefinition.findMany({ where: { id: { in: definitionIds } }, select: { id: true, name: true } }),
      tx.seoProperty.groupBy({ by: ["engagementId"], where: { engagementId: { in: engagements.map((e) => e.id) } }, _count: { id: true } }),
    ]);
    const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
    const definitionNameById = new Map(definitions.map((d) => [d.id, d.name]));
    const propertyCountByEngagement = new Map(propertyCounts.map((p) => [p.engagementId, p._count.id]));

    return engagements.map((engagement) => {
      const cs = customerServiceById.get(engagement.customerServiceId);
      return {
        engagement,
        companyName: cs ? (companyNameById.get(cs.companyId) ?? "Customer") : "Customer",
        serviceName: cs ? (definitionNameById.get(cs.serviceDefinitionId) ?? "SEO") : "SEO",
        customerServiceStatus: cs?.status ?? "UNKNOWN",
        propertyCount: propertyCountByEngagement.get(engagement.id) ?? 0,
      };
    });
  });
}

// --- Engagement -----------------------------------------------------------

const createEngagementSchema = z.object({ customerServiceId: z.string().uuid() });

/** Idempotent — a repeat call for the same `customerServiceId` returns the existing engagement (the plain UNIQUE constraint on `customerServiceId` is the real guarantee; this is the read-side mirror, same pattern Build 29's own `createCustomerServiceFromOnboardingServiceItem()` establishes). */
export async function createSeoEngagement(rawInput: unknown): Promise<SeoEngagement> {
  const input = parseOrThrow(createEngagementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");

  const { engagement, wasCreated } = await withTenantContext(tenantScope, async (tx) => {
    const existing = await seoEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx);
    if (existing) return { engagement: existing, wasCreated: false };

    await assertEligibleSeoCustomerService(input.customerServiceId, organizationId, tx);
    const created = await seoEngagementRepository.create({ id: generateId(), organizationId, customerServiceId: input.customerServiceId, createdByUserId: context.user!.id }, tx);
    return { engagement: created, wasCreated: true };
  });

  if (wasCreated) {
    await audit
      .recordSuccess({ action: "seo.engagement_created", organizationId, resourceType: "seo_engagement", resourceId: engagement.id, resourceName: "SEO engagement", knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
      .catch((error) => console.error("[audit] failed to record seo.engagement_created", error));
  }
  return engagement;
}

const engagementIdSchema = z.object({ engagementId: z.string().uuid() });

export async function getSeoEngagement(rawInput: unknown): Promise<SeoEngagement> {
  const input = parseOrThrow(engagementIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");
  const engagement = await withTenantContext(tenantScope, (tx) => seoEngagementRepository.findById(input.engagementId, tx));
  if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("SEO engagement");
  return engagement;
}

const customerServiceIdSchema = z.object({ customerServiceId: z.string().uuid() });

/** `null` (never throws) when no engagement exists yet — callers (the CustomerService detail page's "Set up SEO workspace" affordance) branch on this. */
export async function getSeoEngagementByCustomerService(rawInput: unknown): Promise<SeoEngagement | null> {
  const input = parseOrThrow(customerServiceIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");
  const engagement = await withTenantContext(tenantScope, (tx) => seoEngagementRepository.findByCustomerServiceId(input.customerServiceId, tx));
  if (!engagement || engagement.organizationId !== organizationId) return null;
  return engagement;
}

export interface SeoEngagementDetail {
  engagement: SeoEngagement;
  customerServiceId: string;
  companyName: string;
  serviceName: string;
  properties: SeoPropertySummary[];
}

export interface SeoPropertySummary {
  property: SeoProperty;
  keywordCount: number;
  freshness: SeoFreshness;
  lastObservedAt: Date | null;
  openIssueCount: number;
}

/** The engagement workspace's own enriched read — bounded batch, never one query per property. */
export async function getSeoEngagementDetail(rawInput: unknown): Promise<SeoEngagementDetail> {
  const engagement = await getSeoEngagement(rawInput);
  const { tenantScope } = await resolveSeoScope("seo.read");

  return withTenantContext(tenantScope, async (tx) => {
    const [customerService, properties] = await Promise.all([tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, serviceDefinitionId: true } }), seoPropertyRepository.listForEngagement(engagement.id, tx)]);
    const [company, definition] = await Promise.all([
      customerService ? tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : Promise.resolve(null),
      customerService ? tx.serviceDefinition.findUnique({ where: { id: customerService.serviceDefinitionId }, select: { name: true } }) : Promise.resolve(null),
    ]);

    const propertyIds = properties.map((p) => p.id);
    const [keywords, issues] = await Promise.all([seoKeywordRepository.listActiveForProperties(propertyIds, tx), seoIssueRepository.listOpenForProperties(propertyIds, tx)]);
    const keywordsByProperty = new Map<string, typeof keywords>();
    for (const k of keywords) keywordsByProperty.set(k.propertyId, [...(keywordsByProperty.get(k.propertyId) ?? []), k]);
    const openIssuesByProperty = new Map<string, number>();
    for (const i of issues) openIssuesByProperty.set(i.propertyId, (openIssuesByProperty.get(i.propertyId) ?? 0) + 1);

    const keywordIds = keywords.map((k) => k.id);
    const latestObservations = await seoRankObservationRepository.listLatestTwoForKeywords(keywordIds, tx);
    const latestByKeyword = new Map<string, Date>();
    for (const obs of latestObservations) {
      if (obs.rank === 1) latestByKeyword.set(obs.keywordId, obs.observedAt);
    }

    const propertySummaries: SeoPropertySummary[] = properties.map((property) => {
      const propKeywords = keywordsByProperty.get(property.id) ?? [];
      const propLastObserved = propKeywords.reduce<Date | null>((latest, k) => {
        const d = latestByKeyword.get(k.id);
        if (!d) return latest;
        return !latest || d > latest ? d : latest;
      }, null);
      return { property, keywordCount: propKeywords.length, freshness: classifyFreshness(propLastObserved), lastObservedAt: propLastObserved, openIssueCount: openIssuesByProperty.get(property.id) ?? 0 };
    });

    return {
      engagement,
      customerServiceId: engagement.customerServiceId,
      companyName: company?.name ?? "Customer",
      serviceName: definition?.name ?? "SEO",
      properties: propertySummaries,
    };
  });
}

// --- Properties -------------------------------------------------------------

const createPropertySchema = z.object({
  engagementId: z.string().uuid(),
  url: z.string().min(1).max(2048),
  targetCountry: z
    .string()
    .length(2)
    .toUpperCase()
    .nullable()
    .optional(),
  targetLocale: z.string().min(2).max(35).nullable().optional(),
});

export async function createSeoProperty(rawInput: unknown): Promise<SeoProperty> {
  const input = parseOrThrow(createPropertySchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");

  let normalized;
  try {
    normalized = normalizePropertyUrl(input.url);
  } catch (error) {
    if (error instanceof InvalidPropertyUrlError) throw new ValidationError(error.message);
    throw error;
  }

  const property = await withTenantContext(tenantScope, async (tx) => {
    const engagement = await seoEngagementRepository.findById(input.engagementId, tx);
    if (!engagement || engagement.organizationId !== organizationId) throw new NotFoundError("SEO engagement");

    const existing = await seoPropertyRepository.findByNormalizedOrigin(input.engagementId, normalized.normalizedOrigin, tx);
    if (existing) throw new ConflictError(`${normalized.normalizedOrigin} is already tracked on this engagement.`);

    return seoPropertyRepository.create(
      { id: generateId(), organizationId, engagementId: input.engagementId, normalizedOrigin: normalized.normalizedOrigin, displayUrl: normalized.displayUrl, targetCountry: input.targetCountry ?? null, targetLocale: input.targetLocale ?? null, createdByUserId: context.user!.id },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "seo.property_added", organizationId, resourceType: "seo_property", resourceId: property.id, resourceName: property.displayUrl, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.property_added", error));
  return property;
}

const propertyIdSchema = z.object({ propertyId: z.string().uuid() });

async function loadPropertyChecked(propertyId: string, organizationId: string, tx: TransactionClient): Promise<SeoProperty> {
  const property = await seoPropertyRepository.findById(propertyId, tx);
  if (!property || property.organizationId !== organizationId) throw new NotFoundError("SEO property");
  return property;
}

export async function archiveSeoProperty(rawInput: unknown): Promise<SeoProperty> {
  const input = parseOrThrow(propertyIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");
  const property = await withTenantContext(tenantScope, async (tx) => {
    await loadPropertyChecked(input.propertyId, organizationId, tx);
    const updated = await seoPropertyRepository.archive(input.propertyId, tx);
    if (!updated) throw new ConflictError("This property was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.property_archived", organizationId, resourceType: "seo_property", resourceId: property.id, resourceName: property.displayUrl, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.property_archived", error));
  return property;
}

export async function reactivateSeoProperty(rawInput: unknown): Promise<SeoProperty> {
  const input = parseOrThrow(propertyIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");
  const property = await withTenantContext(tenantScope, async (tx) => {
    await loadPropertyChecked(input.propertyId, organizationId, tx);
    const updated = await seoPropertyRepository.reactivate(input.propertyId, tx);
    if (!updated) throw new ConflictError("This property was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.property_reactivated", organizationId, resourceType: "seo_property", resourceId: property.id, resourceName: property.displayUrl, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.property_reactivated", error));
  return property;
}

// --- Keywords -----------------------------------------------------------

const createKeywordSchema = z.object({
  propertyId: z.string().uuid(),
  phrase: z.string().trim().min(1).max(200),
  targetUrl: z.string().url().max(2048).nullable().optional(),
  device: z.enum(["DESKTOP", "MOBILE"]),
  country: z.string().length(2).toUpperCase().nullable().optional(),
  locale: z.string().min(2).max(35).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});

export async function createSeoKeyword(rawInput: unknown): Promise<SeoKeyword> {
  const input = parseOrThrow(createKeywordSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");
  const normalizedPhrase = normalizeKeywordPhrase(input.phrase);
  const searchEngine: SeoSearchEngine = "GOOGLE";
  const device: SeoDevice = input.device;

  const keyword = await withTenantContext(tenantScope, async (tx) => {
    const property = await loadPropertyChecked(input.propertyId, organizationId, tx);
    if (input.targetUrl && !urlBelongsToOrigin(input.targetUrl, property.normalizedOrigin)) {
      throw new ValidationError(`targetUrl must be on ${property.normalizedOrigin} — this keyword's property.`);
    }
    const existing = await seoKeywordRepository.findByDedupKey({ propertyId: input.propertyId, normalizedPhrase, searchEngine, device, country: input.country ?? null, locale: input.locale ?? null }, tx);
    if (existing) throw new ConflictError(`"${input.phrase}" is already tracked for this property/device/location combination.`);

    return seoKeywordRepository.create(
      {
        id: generateId(),
        organizationId,
        propertyId: input.propertyId,
        phrase: input.phrase.trim(),
        normalizedPhrase,
        targetUrl: input.targetUrl ?? null,
        searchEngine,
        device,
        country: input.country ?? null,
        locale: input.locale ?? null,
        tags: input.tags,
        createdByUserId: context.user!.id,
      },
      tx,
    );
  });

  await audit
    .recordSuccess({ action: "seo.keyword_added", organizationId, resourceType: "seo_keyword", resourceId: keyword.id, resourceName: keyword.phrase, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.keyword_added", error));
  return keyword;
}

const keywordIdSchema = z.object({ keywordId: z.string().uuid() });

async function loadKeywordChecked(keywordId: string, organizationId: string, tx: TransactionClient): Promise<SeoKeyword> {
  const keyword = await seoKeywordRepository.findById(keywordId, tx);
  if (!keyword || keyword.organizationId !== organizationId) throw new NotFoundError("SEO keyword");
  return keyword;
}

export async function archiveSeoKeyword(rawInput: unknown): Promise<SeoKeyword> {
  const input = parseOrThrow(keywordIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");
  const keyword = await withTenantContext(tenantScope, async (tx) => {
    await loadKeywordChecked(input.keywordId, organizationId, tx);
    const updated = await seoKeywordRepository.archive(input.keywordId, tx);
    if (!updated) throw new ConflictError("This keyword was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.keyword_archived", organizationId, resourceType: "seo_keyword", resourceId: keyword.id, resourceName: keyword.phrase, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.keyword_archived", error));
  return keyword;
}

export async function reactivateSeoKeyword(rawInput: unknown): Promise<SeoKeyword> {
  const input = parseOrThrow(keywordIdSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveSeoScope("seo.manage");
  const keyword = await withTenantContext(tenantScope, async (tx) => {
    await loadKeywordChecked(input.keywordId, organizationId, tx);
    const updated = await seoKeywordRepository.reactivate(input.keywordId, tx);
    if (!updated) throw new ConflictError("This keyword was just changed by someone else. Reload and try again.");
    return updated;
  });
  await audit
    .recordSuccess({ action: "seo.keyword_reactivated", organizationId, resourceType: "seo_keyword", resourceId: keyword.id, resourceName: keyword.phrase, knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined })
    .catch((error) => console.error("[audit] failed to record seo.keyword_reactivated", error));
  return keyword;
}

export interface SeoPropertyKpis {
  trackedKeywordCount: number;
  observedKeywordCount: number;
  top3Count: number;
  top10Count: number;
  top20Count: number;
  averagePosition: number | null;
  improvingCount: number;
  decliningCount: number;
  openIssueCounts: { critical: number; warning: number; info: number };
  freshness: SeoFreshness;
  lastObservedAt: Date | null;
}

export interface SeoPropertyOverview {
  property: SeoProperty;
  engagementId: string;
  kpis: SeoPropertyKpis;
}

/**
 * KPI formulas (see docs/architecture/seo-os.md "KPI formulas" for the
 * full writeup): trackedKeywordCount = every ACTIVE keyword;
 * observedKeywordCount = those with >=1 real observation ever;
 * top3/10/20Count = latest observation RANKED with position <= 3/10/20;
 * averagePosition = mean position over RANKED-latest keywords only
 * (never coerces NOT_FOUND/etc. into a number); improving/declining =
 * latest-vs-previous real observation pair, both RANKED, lower/higher
 * position. All computed from real persisted rows — no fabrication.
 */
export async function getSeoPropertyOverview(rawInput: unknown): Promise<SeoPropertyOverview> {
  const input = parseOrThrow(propertyIdSchema, rawInput);
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");

  return withTenantContext(tenantScope, async (tx) => {
    const property = await loadPropertyChecked(input.propertyId, organizationId, tx);
    const [keywords, openIssues] = await Promise.all([seoKeywordRepository.listActiveForProperty(input.propertyId, tx), seoIssueRepository.listOpenForProperties([input.propertyId], tx)]);

    const openIssueCounts = { critical: openIssues.filter((i) => i.severity === "CRITICAL").length, warning: openIssues.filter((i) => i.severity === "WARNING").length, info: openIssues.filter((i) => i.severity === "INFO").length };

    if (keywords.length === 0) {
      return {
        property,
        engagementId: property.engagementId,
        kpis: { trackedKeywordCount: 0, observedKeywordCount: 0, top3Count: 0, top10Count: 0, top20Count: 0, averagePosition: null, improvingCount: 0, decliningCount: 0, openIssueCounts, freshness: classifyFreshness(null), lastObservedAt: null },
      };
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
    let top3Count = 0;
    let top10Count = 0;
    let top20Count = 0;
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
        if (latest.position <= 3) top3Count++;
        if (latest.position <= 10) top10Count++;
        if (latest.position <= 20) top20Count++;
      }
      const previous = previousByKeyword.get(keyword.id);
      if (previous && latest.rankStatus === "RANKED" && previous.rankStatus === "RANKED" && latest.position !== null && previous.position !== null) {
        if (latest.position < previous.position) improvingCount++;
        else if (latest.position > previous.position) decliningCount++;
      }
    }

    return {
      property,
      engagementId: property.engagementId,
      kpis: {
        trackedKeywordCount: keywords.length,
        observedKeywordCount,
        top3Count,
        top10Count,
        top20Count,
        averagePosition: rankedCount > 0 ? Math.round((positionSum / rankedCount) * 10) / 10 : null,
        improvingCount,
        decliningCount,
        openIssueCounts,
        freshness: classifyFreshness(lastObservedAt),
        lastObservedAt,
      },
    };
  });
}

const listKeywordsSchema = z.object({
  propertyId: z.string().uuid(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  search: z.string().trim().max(200).optional(),
});

export interface SeoKeywordListItem extends SeoKeyword {
  currentPosition: number | null;
  currentRankStatus: string | null;
  currentObservedAt: Date | null;
  previousPosition: number | null;
}

export async function listSeoKeywords(rawInput: unknown): Promise<OffsetPaginatedResult<SeoKeywordListItem>> {
  const input = parseOrThrow(listKeywordsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveSeoScope("seo.read");
  const params: OffsetPaginationParams = { page: input.page, limit: input.limit };
  const filters: SeoKeywordListFilters = { status: input.status, search: input.search };

  return withTenantContext(tenantScope, async (tx) => {
    await loadPropertyChecked(input.propertyId, organizationId, tx);
    const page = await seoKeywordRepository.listForProperty(input.propertyId, params, filters, tx);
    if (page.items.length === 0) return { items: [], pageInfo: page.pageInfo };

    const observations = await seoRankObservationRepository.listLatestTwoForKeywords(page.items.map((k) => k.id), tx);
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
