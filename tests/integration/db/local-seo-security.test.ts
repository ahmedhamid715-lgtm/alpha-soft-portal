import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput, type TenantTransactionClient } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { gbpProfileRepository } from "@/server/repositories/gbp-profile-repository";
import { localListingRepository } from "@/server/repositories/local-listing-repository";
import { localRankObservationRepository } from "@/server/repositories/local-rank-observation-repository";
import { localReviewRepository } from "@/server/repositories/local-review-repository";
import { localSeoAuditRunRepository } from "@/server/repositories/local-seo-audit-run-repository";
import { localSeoEngagementRepository } from "@/server/repositories/local-seo-engagement-repository";
import { localSeoImportBatchRepository } from "@/server/repositories/local-seo-import-batch-repository";
import { localSeoIssueRepository } from "@/server/repositories/local-seo-issue-repository";
import { localSeoKeywordRepository } from "@/server/repositories/local-seo-keyword-repository";
import { localSeoLocationRepository } from "@/server/repositories/local-seo-location-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { userRepository } from "@/server/repositories/user-repository";

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

const LOCAL_SEO_TABLES = [
  "local_seo_engagements",
  "local_seo_locations",
  "gbp_profiles",
  "local_seo_keywords",
  "local_seo_import_batches",
  "local_rank_observations",
  "local_listings",
  "local_reviews",
  "local_seo_audit_runs",
  "local_seo_issues",
] as const;

type LocalSeoGraph = {
  engagementId: string;
  locationId: string;
  profileId: string;
  keywordId: string;
  importBatchId: string;
  observationId: string;
  listingId: string;
  reviewId: string;
  auditRunId: string;
  issueId: string;
};

function errorDiagnostic(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<object>();

  function visit(value: unknown, depth: number): void {
    if (value == null || depth > 8) return;
    if (typeof value !== "object") {
      parts.push(String(value));
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (value instanceof Error) parts.push(value.name, value.message);
    for (const [key, child] of Object.entries(value)) {
      parts.push(key);
      visit(child, depth + 1);
    }
    if (value instanceof Error) visit(value.cause, depth + 1);
  }

  visit(error, 0);
  return parts.join(" ");
}

async function expectPgError(promise: Promise<unknown>, sqlStateOrPrismaCode?: string, messageFragment?: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the restricted database operation to be rejected").toBeDefined();
  const diagnostic = errorDiagnostic(caught);
  if (sqlStateOrPrismaCode) expect(diagnostic).toContain(sqlStateOrPrismaCode);
  if (messageFragment) expect(diagnostic.toLowerCase()).toContain(messageFragment.toLowerCase());
}

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("Local SEO database security (Build 31)", () => {
  let platformOrgId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;
  let companyId: string;
  let localSeoDefinitionId: string;
  let seoDefinitionId: string;
  let webDefinitionId: string;
  let localSeoCustomerServiceId: string;
  let seoCustomerServiceId: string;
  let webCustomerServiceId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const definitionIds: string[] = [];
  const customerServiceIds: string[] = [];
  const engagementIds: string[] = [];
  const locationIds: string[] = [];
  const profileIds: string[] = [];
  const keywordIds: string[] = [];
  const importBatchIds: string[] = [];
  const observationIds: string[] = [];
  const listingIds: string[] = [];
  const reviewIds: string[] = [];
  const auditRunIds: string[] = [];
  const issueIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    platformOrgId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!platformOrgId) {
      platformOrgId = generateId();
      organizationIds.push(platformOrgId);
      await db.organization.create({ data: { id: platformOrgId, name: "Platform", displayName: "Platform", slug: `local-seo-platform-${platformOrgId}`, isPlatform: true } });
    }

    customerOrgAId = await createOrganization("Local SEO Customer A");
    customerOrgBId = await createOrganization("Local SEO Customer B");
    platformUserId = generateId();
    userIds.push(platformUserId);
    await userRepository.create({ id: platformUserId, email: `local-seo-rls-${platformUserId}@example.com`, name: `Local SEO RLS Actor ${platformUserId}` });

    companyId = generateId();
    companyIds.push(companyId);
    localSeoDefinitionId = generateId();
    seoDefinitionId = generateId();
    webDefinitionId = generateId();
    definitionIds.push(localSeoDefinitionId, seoDefinitionId, webDefinitionId);
    localSeoCustomerServiceId = generateId();
    seoCustomerServiceId = generateId();
    webCustomerServiceId = generateId();
    customerServiceIds.push(localSeoCustomerServiceId, seoCustomerServiceId, webCustomerServiceId);

    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `Local SEO Company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyId, customerOrgAId, tx);
      await serviceDefinitionRepository.create({ id: localSeoDefinitionId, organizationId: platformOrgId, name: `Local SEO ${localSeoDefinitionId}`, code: `LOCAL-SEO-${localSeoDefinitionId}`, description: null, category: "LOCAL_SEO", deliveryCadence: "RECURRING", sortOrder: 0 }, tx);
      await serviceDefinitionRepository.create({ id: seoDefinitionId, organizationId: platformOrgId, name: `Organic SEO ${seoDefinitionId}`, code: `SEO-${seoDefinitionId}`, description: null, category: "SEO", deliveryCadence: "RECURRING", sortOrder: 1 }, tx);
      await serviceDefinitionRepository.create({ id: webDefinitionId, organizationId: platformOrgId, name: `Web Build ${webDefinitionId}`, code: `WEB-${webDefinitionId}`, description: null, category: "WEB_DEVELOPMENT", deliveryCadence: "ONE_TIME", sortOrder: 2 }, tx);
      await customerServiceRepository.create(customerServiceInput(localSeoCustomerServiceId, localSeoDefinitionId), tx);
      await customerServiceRepository.create(customerServiceInput(seoCustomerServiceId, seoDefinitionId), tx);
      await customerServiceRepository.create(customerServiceInput(webCustomerServiceId, webDefinitionId), tx);
    });
  });

  afterEach(async () => {
    if (issueIds.length) await db.localSeoIssue.deleteMany({ where: { id: { in: issueIds } } });
    if (observationIds.length) await db.localRankObservation.deleteMany({ where: { id: { in: observationIds } } });
    if (auditRunIds.length) await db.localSeoAuditRun.deleteMany({ where: { id: { in: auditRunIds } } });
    if (reviewIds.length) await db.localReview.deleteMany({ where: { id: { in: reviewIds } } });
    if (listingIds.length) await db.localListing.deleteMany({ where: { id: { in: listingIds } } });
    if (importBatchIds.length) await db.localSeoImportBatch.deleteMany({ where: { id: { in: importBatchIds } } });
    if (profileIds.length) await db.gbpProfile.deleteMany({ where: { id: { in: profileIds } } });
    if (keywordIds.length) await db.localSeoKeyword.deleteMany({ where: { id: { in: keywordIds } } });
    if (locationIds.length) await db.localSeoLocation.deleteMany({ where: { id: { in: locationIds } } });
    if (engagementIds.length) await db.localSeoEngagement.deleteMany({ where: { id: { in: engagementIds } } });
    if (customerServiceIds.length) await db.customerService.deleteMany({ where: { id: { in: customerServiceIds } } });
    if (definitionIds.length) await db.serviceDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    for (const ids of [issueIds, observationIds, auditRunIds, reviewIds, listingIds, importBatchIds, profileIds, keywordIds, locationIds, engagementIds, customerServiceIds, definitionIds, companyIds, userIds, organizationIds]) ids.length = 0;
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `local-seo-rls-${id}` });
    return id;
  }

  function customerServiceInput(id: string, serviceDefinitionId: string) {
    return {
      id,
      organizationId: platformOrgId,
      customerOrganizationId: customerOrgAId,
      companyId,
      serviceDefinitionId,
      sourceOnboardingServiceItemId: null,
      quantity: 1,
      ownerUserId: null,
      startDate: null,
      targetEndDate: null,
      createdByUserId: platformUserId,
    };
  }

  async function createEngagement(customerServiceId = localSeoCustomerServiceId): Promise<string> {
    const id = generateId();
    engagementIds.push(id);
    await withTenantContext(platformContext(), (tx) => localSeoEngagementRepository.create({ id, organizationId: platformOrgId, customerServiceId, createdByUserId: platformUserId }, tx));
    return id;
  }

  async function createLocation(engagementId: string, businessName = `Local SEO Location ${generateId()}`): Promise<string> {
    const id = generateId();
    locationIds.push(id);
    await withTenantContext(platformContext(), (tx) =>
      localSeoLocationRepository.create(
        {
          id,
          organizationId: platformOrgId,
          engagementId,
          businessName,
          addressLine1: null,
          addressLine2: null,
          city: null,
          region: null,
          postalCode: null,
          country: null,
          phone: null,
          websiteUrl: null,
          normalizedWebsiteOrigin: null,
          serviceAreaBusiness: false,
          source: "MANUAL",
          createdByUserId: platformUserId,
        },
        tx,
      ),
    );
    return id;
  }

  function keywordInput(locationId: string, overrides: Record<string, unknown> = {}) {
    const phrase = `keyword ${generateId()}`;
    return {
      id: generateId(),
      organizationId: platformOrgId,
      locationId,
      phrase,
      normalizedPhrase: phrase,
      searchSurface: "LOCAL_PACK" as const,
      device: "DESKTOP" as const,
      country: null,
      locale: null,
      searchLat: null,
      searchLng: null,
      searchLabel: null,
      tags: [],
      createdByUserId: platformUserId,
      ...overrides,
    };
  }

  async function createKeyword(locationId: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const input = keywordInput(locationId, overrides);
    keywordIds.push(input.id);
    await withTenantContext(platformContext(), (tx) => localSeoKeywordRepository.create(input as Parameters<typeof localSeoKeywordRepository.create>[0], tx));
    return input.id;
  }

  function reviewInput(locationId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: generateId(),
      organizationId: platformOrgId,
      locationId,
      externalReviewId: null,
      rating: 5,
      reviewedAt: new Date("2026-09-14T10:00:00.000Z"),
      reviewerDisplayName: "Fixture reviewer",
      text: "Fixture review",
      source: "MANUAL" as const,
      importBatchId: null,
      createdByUserId: platformUserId,
      ...overrides,
    };
  }

  function issueInput(locationId: string, overrides: Record<string, unknown> = {}) {
    const now = new Date("2026-09-14T12:00:00.000Z");
    return {
      id: generateId(),
      organizationId: platformOrgId,
      locationId,
      issueType: "NAP_INCONSISTENCY" as const,
      severity: "WARNING" as const,
      title: "NAP mismatch",
      description: null,
      detectedByAuditRunId: null,
      firstDetectedAt: now,
      lastDetectedAt: now,
      createdByUserId: platformUserId,
      ...overrides,
    };
  }

  async function seedFullGraph(): Promise<LocalSeoGraph> {
    const engagementId = await createEngagement();
    const locationId = await createLocation(engagementId);
    const profileId = generateId();
    const keywordId = await createKeyword(locationId);
    const importBatchId = generateId();
    const observationId = generateId();
    const listingId = generateId();
    const review = reviewInput(locationId);
    const auditRunId = generateId();
    const issue = issueInput(locationId, { detectedByAuditRunId: auditRunId });
    profileIds.push(profileId);
    importBatchIds.push(importBatchId);
    observationIds.push(observationId);
    listingIds.push(listingId);
    reviewIds.push(review.id);
    auditRunIds.push(auditRunId);
    issueIds.push(issue.id);

    await withTenantContext(platformContext(), async (tx) => {
      await gbpProfileRepository.create({ id: profileId, organizationId: platformOrgId, locationId, externalProfileId: null, profileUrl: null, primaryCategory: null, secondaryCategories: [], verificationState: "NOT_MEASURED", observedStatus: null, lastObservedAt: null, source: "MANUAL", createdByUserId: platformUserId }, tx);
      await localSeoImportBatchRepository.create({ id: importBatchId, organizationId: platformOrgId, engagementId, fileName: "local-seo-security.csv", rowCount: 1, importedCount: 1, skippedCount: 0, createdByUserId: platformUserId }, tx);
      await localRankObservationRepository.create({ id: observationId, organizationId: platformOrgId, keywordId, observedAt: new Date("2026-09-14T08:00:00.000Z"), source: "IMPORT", rankStatus: "RANKED", position: 3, rankingProfileUrl: "https://example.com/profile", notes: null, importBatchId, createdByUserId: platformUserId }, tx);
      await localListingRepository.upsertObservation(listingId, locationId, platformOrgId, "Google", platformUserId, { sourceUrl: null, observedBusinessName: "Fixture business", observedAddressLine1: null, observedCity: null, observedPostalCode: null, observedPhone: null, observedWebsiteUrl: null, observedAt: new Date("2026-09-14T09:00:00.000Z"), source: "MANUAL", importBatchId: null }, tx);
      await localReviewRepository.create(review as Parameters<typeof localReviewRepository.create>[0], tx);
      await localSeoAuditRunRepository.create({ id: auditRunId, organizationId: platformOrgId, locationId, source: "MANUAL", status: "COMPLETED", startedAt: new Date("2026-09-14T11:00:00.000Z"), completedAt: new Date("2026-09-14T11:05:00.000Z"), summary: null, createdByUserId: platformUserId }, tx);
      await localSeoIssueRepository.create(issue as Parameters<typeof localSeoIssueRepository.create>[0], tx);
    });
    return { engagementId, locationId, profileId, keywordId, importBatchId, observationId, listingId, reviewId: review.id, auditRunId, issueId: issue.id };
  }

  async function countsForAllTables(context: TenantContextInput): Promise<Record<(typeof LOCAL_SEO_TABLES)[number], number>> {
    return withTenantContext(context, async (tx) => ({
      local_seo_engagements: await tx.localSeoEngagement.count(),
      local_seo_locations: await tx.localSeoLocation.count(),
      gbp_profiles: await tx.gbpProfile.count(),
      local_seo_keywords: await tx.localSeoKeyword.count(),
      local_seo_import_batches: await tx.localSeoImportBatch.count(),
      local_rank_observations: await tx.localRankObservation.count(),
      local_listings: await tx.localListing.count(),
      local_reviews: await tx.localReview.count(),
      local_seo_audit_runs: await tx.localSeoAuditRun.count(),
      local_seo_issues: await tx.localSeoIssue.count(),
    }));
  }

  describe("RLS and grants", () => {
    it("fails closed with no tenant context on all ten Local SEO tables", async () => {
      await seedFullGraph();
      expect(await countsForAllTables(NO_TENANT_CONTEXT)).toEqual(Object.fromEntries(LOCAL_SEO_TABLES.map((table) => [table, 0])));
    });

    it("hides all ten tables from either bare customer-organization context", async () => {
      await seedFullGraph();
      for (const organizationId of [customerOrgAId, customerOrgBId]) {
        expect(await countsForAllTables({ userId: platformUserId, organizationId, isPlatformStaff: false })).toEqual(Object.fromEntries(LOCAL_SEO_TABLES.map((table) => [table, 0])));
      }
    });

    it("rejects raw DELETE statements against all ten tables", async () => {
      const graph = await seedFullGraph();
      const ids: Record<(typeof LOCAL_SEO_TABLES)[number], string> = {
        local_seo_engagements: graph.engagementId,
        local_seo_locations: graph.locationId,
        gbp_profiles: graph.profileId,
        local_seo_keywords: graph.keywordId,
        local_seo_import_batches: graph.importBatchId,
        local_rank_observations: graph.observationId,
        local_listings: graph.listingId,
        local_reviews: graph.reviewId,
        local_seo_audit_runs: graph.auditRunId,
        local_seo_issues: graph.issueId,
      };
      for (const table of LOCAL_SEO_TABLES) {
        await expectPgError(withTenantContext(platformContext(), (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = $1::uuid`, ids[table])), "42501", `permission denied for table ${table}`);
      }
    });

    it("rejects UPDATE of rank observations but permits listing and review updates", async () => {
      const graph = await seedFullGraph();
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.$executeRaw`UPDATE local_rank_observations SET notes = 'tampered' WHERE id = ${graph.observationId}::uuid`), "42501", "permission denied for table local_rank_observations");

      await withTenantContext(platformContext(), async (tx) => {
        const listing = await tx.localListing.update({ where: { id: graph.listingId }, data: { observedBusinessName: "Updated listing" } });
        const review = await localReviewRepository.recordResponse(graph.reviewId, { responseStatus: "DRAFTED", responseText: "Draft response", respondedAt: null, respondedByUserId: null }, tx);
        expect(listing.observedBusinessName).toBe("Updated listing");
        expect(review.responseStatus).toBe("DRAFTED");
      });
    });
  });

  describe("relationship-integrity trigger", () => {
    it("accepts LOCAL_SEO and rejects both SEO and WEB_DEVELOPMENT CustomerServices", async () => {
      const acceptedId = await createEngagement(localSeoCustomerServiceId);
      expect((await withTenantContext(platformContext(), (tx) => localSeoEngagementRepository.findById(acceptedId, tx)))?.customerServiceId).toBe(localSeoCustomerServiceId);

      for (const customerServiceId of [seoCustomerServiceId, webCustomerServiceId]) {
        const id = generateId();
        engagementIds.push(id);
        await expectPgError(
          withTenantContext(platformContext(), (tx) => localSeoEngagementRepository.create({ id, organizationId: platformOrgId, customerServiceId, createdByUserId: platformUserId }, tx)),
          "23514",
          "must use a service definition with category LOCAL_SEO",
        );
      }
    });

    it("uses a genuinely separate trigger function from SEO OS", async () => {
      const functions = await withTenantContext(platformContext(), (tx) =>
        tx.$queryRaw<Array<{ oid: string; proname: string; definition: string }>>`
          SELECT p.oid::text AS oid, p.proname, pg_get_functiondef(p.oid) AS definition
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = current_schema()
            AND p.proname IN ('local_seo_engagements_enforce_relationship_integrity', 'seo_engagements_enforce_relationship_integrity')
          ORDER BY p.proname
        `,
      );
      expect(functions.map((fn) => fn.proname).sort()).toEqual(["local_seo_engagements_enforce_relationship_integrity", "seo_engagements_enforce_relationship_integrity"]);
      expect(new Set(functions.map((fn) => fn.oid)).size).toBe(2);
      const local = functions.find((fn) => fn.proname.startsWith("local_seo_"));
      const organic = functions.find((fn) => fn.proname.startsWith("seo_"));
      expect(local?.definition).toContain("'LOCAL_SEO'::service_category");
      expect(organic?.definition).toContain("'SEO'::service_category");
      expect(local?.definition).not.toBe(organic?.definition);
    });
  });

  describe("idempotency and uniqueness", () => {
    it("rejects a second engagement for the same CustomerService", async () => {
      await createEngagement();
      const id = generateId();
      engagementIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => localSeoEngagementRepository.create({ id, organizationId: platformOrgId, customerServiceId: localSeoCustomerServiceId, createdByUserId: platformUserId }, tx)), "P2002");
    });

    it("rejects a second GBP profile for the same location", async () => {
      const locationId = await createLocation(await createEngagement());
      const firstId = generateId();
      const secondId = generateId();
      profileIds.push(firstId, secondId);
      const input = { organizationId: platformOrgId, locationId, externalProfileId: null, profileUrl: null, primaryCategory: null, secondaryCategories: [], verificationState: "NOT_MEASURED" as const, observedStatus: null, lastObservedAt: null, source: "MANUAL" as const, createdByUserId: platformUserId };
      await withTenantContext(platformContext(), (tx) => gbpProfileRepository.create({ id: firstId, ...input }, tx));
      await expectPgError(withTenantContext(platformContext(), (tx) => gbpProfileRepository.create({ id: secondId, ...input }, tx)), "P2002");
    });

    it("functional keyword dedup rejects duplicates with all nullable dimensions NULL", async () => {
      const locationId = await createLocation(await createEngagement());
      const phrase = `null dimensions ${generateId()}`;
      await createKeyword(locationId, { phrase, normalizedPhrase: phrase, country: null, locale: null, searchLabel: null });
      const duplicate = keywordInput(locationId, { phrase, normalizedPhrase: phrase, country: null, locale: null, searchLabel: null });
      keywordIds.push(duplicate.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => localSeoKeywordRepository.create(duplicate as Parameters<typeof localSeoKeywordRepository.create>[0], tx)), "P2002");
    });

    it("rejects a second rank observation for the same keyword and observedAt", async () => {
      const keywordId = await createKeyword(await createLocation(await createEngagement()));
      const observedAt = new Date("2026-09-14T15:00:00.000Z");
      const input = { organizationId: platformOrgId, keywordId, observedAt, source: "MANUAL" as const, rankStatus: "RANKED" as const, position: 1, rankingProfileUrl: null, notes: null, importBatchId: null, createdByUserId: platformUserId };
      const firstId = generateId();
      const secondId = generateId();
      observationIds.push(firstId, secondId);
      await withTenantContext(platformContext(), (tx) => localRankObservationRepository.create({ id: firstId, ...input }, tx));
      await expectPgError(withTenantContext(platformContext(), (tx) => localRankObservationRepository.create({ id: secondId, ...input }, tx)), "P2002");
    });

    it("listing uniqueness is the conflict target used by upsertObservation", async () => {
      const locationId = await createLocation(await createEngagement());
      const firstId = generateId();
      const duplicateId = generateId();
      listingIds.push(firstId, duplicateId);
      const observation = { sourceUrl: null, observedBusinessName: "First", observedAddressLine1: null, observedCity: null, observedPostalCode: null, observedPhone: null, observedWebsiteUrl: null, observedAt: new Date("2026-09-14T16:00:00.000Z"), source: "MANUAL" as const, importBatchId: null };
      await withTenantContext(platformContext(), (tx) => localListingRepository.upsertObservation(firstId, locationId, platformOrgId, "Bing", platformUserId, observation, tx));
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.localListing.create({ data: { id: duplicateId, organizationId: platformOrgId, locationId, sourceName: "Bing", createdByUserId: platformUserId, ...observation } })),
        "P2002",
      );
      const upserted = await withTenantContext(platformContext(), (tx) => localListingRepository.upsertObservation(generateId(), locationId, platformOrgId, "Bing", platformUserId, { ...observation, observedBusinessName: "Second" }, tx));
      expect(upserted.id).toBe(firstId);
      expect(upserted.observedBusinessName).toBe("Second");
      expect(await withTenantContext(platformContext(), (tx) => tx.localListing.count({ where: { locationId, sourceName: "Bing" } }))).toBe(1);
    });

    it("review partial index rejects known external IDs but permits two NULL IDs", async () => {
      const locationId = await createLocation(await createEngagement());
      const externalReviewId = `external-${generateId()}`;
      const knownA = reviewInput(locationId, { externalReviewId });
      const knownB = reviewInput(locationId, { externalReviewId });
      const manualA = reviewInput(locationId, { externalReviewId: null });
      const manualB = reviewInput(locationId, { externalReviewId: null });
      reviewIds.push(knownA.id, knownB.id, manualA.id, manualB.id);
      await withTenantContext(platformContext(), (tx) => localReviewRepository.create(knownA as Parameters<typeof localReviewRepository.create>[0], tx));
      await expectPgError(withTenantContext(platformContext(), (tx) => localReviewRepository.create(knownB as Parameters<typeof localReviewRepository.create>[0], tx)), "P2002");
      await withTenantContext(platformContext(), async (tx) => {
        await localReviewRepository.create(manualA as Parameters<typeof localReviewRepository.create>[0], tx);
        await localReviewRepository.create(manualB as Parameters<typeof localReviewRepository.create>[0], tx);
      });
      expect(await withTenantContext(platformContext(), (tx) => tx.localReview.count({ where: { id: { in: [manualA.id, manualB.id] } } }))).toBe(2);
    });

    it("allows exactly one winner in a real concurrent engagement race", async () => {
      const idA = generateId();
      const idB = generateId();
      engagementIds.push(idA, idB);
      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) =>
          localSeoEngagementRepository
            .create({ id, organizationId: platformOrgId, customerServiceId: localSeoCustomerServiceId, createdByUserId: platformUserId }, tx)
            .then(() => "fulfilled" as const)
            .catch((error: unknown) => ({ status: "rejected" as const, diagnostic: errorDiagnostic(error) })),
        );
      const results = await Promise.all([attempt(idA), attempt(idB)]);
      expect(results.filter((result) => result === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result !== "fulfilled");
      expect(rejected).toBeDefined();
      if (rejected !== undefined) expect(rejected.diagnostic).toContain("P2002");
    });
  });

  describe("CHECK constraints", () => {
    it.each([
      ["RANKED with NULL position", "RANKED", null],
      ["RANKED with zero position", "RANKED", 0],
      ["RANKED with negative position", "RANKED", -1],
      ["NOT_FOUND with a position", "NOT_FOUND", 10],
    ] as const)("rejects %s", async (_label, rankStatus, position) => {
      const keywordId = await createKeyword(await createLocation(await createEngagement()));
      const id = generateId();
      observationIds.push(id);
      await expectPgError(withTenantContext(platformContext(), (tx) => localRankObservationRepository.create({ id, organizationId: platformOrgId, keywordId, observedAt: new Date(), source: "MANUAL", rankStatus, position, rankingProfileUrl: null, notes: null, importBatchId: null, createdByUserId: platformUserId }, tx)), "23514", "local_rank_observations_position_consistency_check");
    });

    it.each([
      ["missing longitude", 10, null],
      ["latitude too low", -91, 20],
      ["latitude too high", 91, 20],
      ["longitude too low", 10, -181],
      ["longitude too high", 10, 181],
    ] as const)("rejects invalid coordinates: %s", async (_label, searchLat, searchLng) => {
      const locationId = await createLocation(await createEngagement());
      const input = keywordInput(locationId, { searchLat, searchLng });
      keywordIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => localSeoKeywordRepository.create(input as Parameters<typeof localSeoKeywordRepository.create>[0], tx)), "23514", "local_seo_keywords_coordinates_check");
    });

    it("accepts keyword coordinates when both are NULL", async () => {
      const id = await createKeyword(await createLocation(await createEngagement()), { searchLat: null, searchLng: null });
      expect(await withTenantContext(platformContext(), (tx) => localSeoKeywordRepository.findById(id, tx))).not.toBeNull();
    });

    it.each([0, 6])("rejects review rating %i", async (rating) => {
      const locationId = await createLocation(await createEngagement());
      const input = reviewInput(locationId, { rating });
      reviewIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => localReviewRepository.create(input as Parameters<typeof localReviewRepository.create>[0], tx)), "23514", "local_reviews_rating_check");
    });

    it.each([1, 5])("accepts boundary review rating %i", async (rating) => {
      const locationId = await createLocation(await createEngagement());
      const input = reviewInput(locationId, { rating });
      reviewIds.push(input.id);
      const row = await withTenantContext(platformContext(), (tx) => localReviewRepository.create(input as Parameters<typeof localReviewRepository.create>[0], tx));
      expect(row.rating).toBe(rating);
    });

    it.each([
      ["RESPONDED without respondedAt", { responseStatus: "RESPONDED", respondedAt: null, respondedByUserId: "ACTOR" }],
      ["NONE with respondedAt", { responseStatus: "NONE", respondedAt: new Date(), respondedByUserId: null }],
    ])("rejects inconsistent review response metadata: %s", async (_label, overrides) => {
      const locationId = await createLocation(await createEngagement());
      const input = reviewInput(locationId, { ...overrides, ...(overrides.respondedByUserId === "ACTOR" ? { respondedByUserId: platformUserId } : {}) });
      reviewIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.localReview.create({ data: input as never })), "23514", "local_reviews_response_consistency_check");
    });

    it("rejects inconsistent resolved issue metadata", async () => {
      const input = issueInput(await createLocation(await createEngagement()), { resolvedAt: new Date(), resolvedByUserId: null });
      issueIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.localSeoIssue.create({ data: input as never })), "23514", "local_seo_issues_resolved_consistency_check");
    });

    it.each([
      ["missing actor", { ignoredAt: new Date(), ignoredByUserId: null, ignoredReason: "accepted risk" }],
      ["blank reason", { ignoredAt: new Date(), ignoredByUserId: "ACTOR", ignoredReason: "   " }],
    ])("rejects ignored issue metadata with %s", async (_label, overrides) => {
      const input = issueInput(await createLocation(await createEngagement()), { ...overrides, ...(overrides.ignoredByUserId === "ACTOR" ? { ignoredByUserId: platformUserId } : {}) });
      issueIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.localSeoIssue.create({ data: input as never })), "23514", "local_seo_issues_ignored_consistency_check");
    });

    it("rejects inconsistent acknowledged issue metadata", async () => {
      const input = issueInput(await createLocation(await createEngagement()), { acknowledgedAt: new Date(), acknowledgedByUserId: null });
      issueIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.localSeoIssue.create({ data: input as never })), "23514", "local_seo_issues_acknowledged_consistency_check");
    });

    it("rejects lastDetectedAt before firstDetectedAt", async () => {
      const input = issueInput(await createLocation(await createEngagement()), { firstDetectedAt: new Date("2026-09-14T13:00:00.000Z"), lastDetectedAt: new Date("2026-09-14T12:59:59.999Z") });
      issueIds.push(input.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.localSeoIssue.create({ data: input as never })), "23514", "local_seo_issues_detection_order_check");
    });

    it("rejects whitespace for every Local SEO non-blank constraint", async () => {
      const engagementId = await createEngagement();
      const badLocationId = generateId();
      locationIds.push(badLocationId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.localSeoLocation.create({ data: { id: badLocationId, organizationId: platformOrgId, engagementId, businessName: "   ", source: "MANUAL", createdByUserId: platformUserId } })),
        "23514",
        "local_seo_locations_business_name_non_blank_check",
      );

      const locationId = await createLocation(engagementId);
      for (const [field, constraint] of [
        ["phrase", "local_seo_keywords_phrase_non_blank_check"],
        ["normalizedPhrase", "local_seo_keywords_normalized_phrase_non_blank_check"],
      ] as const) {
        const input = keywordInput(locationId, { [field]: "   " });
        keywordIds.push(input.id);
        await expectPgError(withTenantContext(platformContext(), (tx) => localSeoKeywordRepository.create(input as Parameters<typeof localSeoKeywordRepository.create>[0], tx)), "23514", constraint);
      }

      const listingId = generateId();
      listingIds.push(listingId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.localListing.create({ data: { id: listingId, organizationId: platformOrgId, locationId, sourceName: "   ", observedAt: new Date(), source: "MANUAL", createdByUserId: platformUserId } })),
        "23514",
        "local_listings_source_name_non_blank_check",
      );

      const issue = issueInput(locationId, { title: "   " });
      issueIds.push(issue.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.localSeoIssue.create({ data: issue as never })), "23514", "local_seo_issues_title_non_blank_check");
    });
  });

  describe("forged organization relationships", () => {
    /**
     * Two independent layers can reject a forged cross-organization
     * insert: RLS's own `WITH CHECK` (SQLSTATE 42501) on every table,
     * and — as of the Build 31 security-remediation follow-up
     * (Codex Security Engineer finding LS-SEC-01) — a dedicated
     * `local_seo_<table>_enforce_organization_integrity()` trigger on
     * each of the nine CHILD tables (SQLSTATE 23514), which fires
     * BEFORE the RLS `WITH CHECK` is evaluated for an INSERT and so
     * wins the race on those nine. `local_seo_engagements` itself has
     * no such trigger (it has no tenant-owned parent to compare
     * against beyond its own category trigger), so it still surfaces
     * pure RLS. Either SQLSTATE is a correct, defense-in-depth
     * rejection — this test asserts the operation is REJECTED and, for
     * each table, that a SQLSTATE from the expected set was the cause,
     * never that one specific layer must be the one that caught it.
     */
    it("rejects a mismatched organizationId on every Local SEO table (RLS and/or relationship-integrity trigger)", async () => {
      const graph = await seedFullGraph();
      const forgedCustomerServiceId = generateId();
      customerServiceIds.push(forgedCustomerServiceId);
      await withTenantContext(platformContext(), (tx) => customerServiceRepository.create(customerServiceInput(forgedCustomerServiceId, localSeoDefinitionId), tx));

      const attempts: Array<[string, (tx: TenantTransactionClient) => Promise<unknown>]> = [
        ["local_seo_engagements", (tx) => tx.localSeoEngagement.create({ data: { id: generateId(), organizationId: customerOrgBId, customerServiceId: forgedCustomerServiceId, createdByUserId: platformUserId } })],
        ["local_seo_locations", (tx) => tx.localSeoLocation.create({ data: { id: generateId(), organizationId: customerOrgBId, engagementId: graph.engagementId, businessName: "Forged location", source: "MANUAL", createdByUserId: platformUserId } })],
        ["gbp_profiles", (tx) => tx.gbpProfile.create({ data: { id: generateId(), organizationId: customerOrgBId, locationId: graph.locationId, source: "MANUAL", createdByUserId: platformUserId } })],
        ["local_seo_keywords", (tx) => tx.localSeoKeyword.create({ data: { id: generateId(), organizationId: customerOrgBId, locationId: graph.locationId, phrase: "forged", normalizedPhrase: "forged", device: "MOBILE", createdByUserId: platformUserId } })],
        ["local_seo_import_batches", (tx) => tx.localSeoImportBatch.create({ data: { id: generateId(), organizationId: customerOrgBId, engagementId: graph.engagementId, rowCount: 0, importedCount: 0, skippedCount: 0, createdByUserId: platformUserId } })],
        ["local_rank_observations", (tx) => tx.localRankObservation.create({ data: { id: generateId(), organizationId: customerOrgBId, keywordId: graph.keywordId, observedAt: new Date("2026-09-15T00:00:00.000Z"), source: "MANUAL", rankStatus: "NOT_FOUND", position: null, createdByUserId: platformUserId } })],
        ["local_listings", (tx) => tx.localListing.create({ data: { id: generateId(), organizationId: customerOrgBId, locationId: graph.locationId, sourceName: "Forged source", observedAt: new Date(), source: "MANUAL", createdByUserId: platformUserId } })],
        ["local_reviews", (tx) => tx.localReview.create({ data: { id: generateId(), organizationId: customerOrgBId, locationId: graph.locationId, rating: 5, source: "MANUAL", createdByUserId: platformUserId } })],
        ["local_seo_audit_runs", (tx) => tx.localSeoAuditRun.create({ data: { id: generateId(), organizationId: customerOrgBId, locationId: graph.locationId, source: "MANUAL", status: "COMPLETED", startedAt: new Date(), createdByUserId: platformUserId } })],
        ["local_seo_issues", (tx) => tx.localSeoIssue.create({ data: issueInput(graph.locationId, { id: generateId(), organizationId: customerOrgBId, issueType: "MISSING_LISTING" }) as never })],
      ];
      for (const [table, attempt] of attempts) {
        let caught: unknown;
        try {
          await withTenantContext(platformContext(), attempt);
        } catch (error) {
          caught = error;
        }
        expect(caught, `expected the forged ${table} insert to be rejected`).toBeDefined();
        const diagnostic = errorDiagnostic(caught);
        expect(diagnostic.includes("42501") || diagnostic.includes("23514"), `expected ${table}'s rejection to be SQLSTATE 42501 (RLS) or 23514 (relationship-integrity trigger), got: ${diagnostic}`).toBe(true);
      }
    });
  });
});
