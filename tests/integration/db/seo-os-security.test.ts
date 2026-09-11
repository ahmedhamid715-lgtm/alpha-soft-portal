import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDatabaseConfigured } from "@/config/environment";
import { db } from "@/lib/db/client";
import { isTenantRoleConfigured } from "@/lib/tenancy/client";
import { withTenantContext, type TenantContextInput, type TenantTransactionClient } from "@/lib/tenancy/context";
import { generateId } from "@/lib/utils/id";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { seoAuditRunRepository } from "@/server/repositories/seo-audit-run-repository";
import { seoEngagementRepository } from "@/server/repositories/seo-engagement-repository";
import { seoImportBatchRepository } from "@/server/repositories/seo-import-batch-repository";
import { seoIssueRepository } from "@/server/repositories/seo-issue-repository";
import { seoKeywordRepository } from "@/server/repositories/seo-keyword-repository";
import { seoPropertyRepository } from "@/server/repositories/seo-property-repository";
import { seoRankObservationRepository } from "@/server/repositories/seo-rank-observation-repository";
import { serviceDefinitionRepository } from "@/server/repositories/service-definition-repository";
import { userRepository } from "@/server/repositories/user-repository";

const NO_TENANT_CONTEXT: TenantContextInput = { userId: null, organizationId: null, isPlatformStaff: false };

const SEO_TABLES = [
  "seo_engagements",
  "seo_properties",
  "seo_keywords",
  "seo_import_batches",
  "seo_rank_observations",
  "seo_audit_runs",
  "seo_issues",
] as const;

type SeoGraph = {
  engagementId: string;
  propertyId: string;
  keywordId: string;
  importBatchId: string;
  observationId: string;
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

describe.skipIf(!isDatabaseConfigured || !isTenantRoleConfigured)("SEO OS database security (Build 30)", () => {
  let platformOrgId: string;
  let customerOrgAId: string;
  let customerOrgBId: string;
  let platformUserId: string;
  let companyId: string;
  let seoDefinitionId: string;
  let webDefinitionId: string;
  let seoCustomerServiceId: string;
  let webCustomerServiceId: string;

  const organizationIds: string[] = [];
  const userIds: string[] = [];
  const companyIds: string[] = [];
  const definitionIds: string[] = [];
  const customerServiceIds: string[] = [];
  const engagementIds: string[] = [];
  const propertyIds: string[] = [];
  const keywordIds: string[] = [];
  const importBatchIds: string[] = [];
  const observationIds: string[] = [];
  const auditRunIds: string[] = [];
  const issueIds: string[] = [];

  const platformContext = (): TenantContextInput => ({ userId: platformUserId, organizationId: platformOrgId, isPlatformStaff: true });

  beforeEach(async () => {
    platformOrgId = (await organizationRepository.findPlatformOrganization())?.id ?? "";
    if (!platformOrgId) {
      platformOrgId = generateId();
      organizationIds.push(platformOrgId);
      await db.organization.create({ data: { id: platformOrgId, name: "Platform", displayName: "Platform", slug: `seo-os-platform-${platformOrgId}`, isPlatform: true } });
    }

    customerOrgAId = await createOrganization("SEO OS Customer A");
    customerOrgBId = await createOrganization("SEO OS Customer B");
    platformUserId = generateId();
    userIds.push(platformUserId);
    await userRepository.create({ id: platformUserId, email: `seo-os-rls-${platformUserId}@example.com`, name: `SEO OS RLS Actor ${platformUserId}` });

    companyId = generateId();
    companyIds.push(companyId);
    seoDefinitionId = generateId();
    webDefinitionId = generateId();
    definitionIds.push(seoDefinitionId, webDefinitionId);
    seoCustomerServiceId = generateId();
    webCustomerServiceId = generateId();
    customerServiceIds.push(seoCustomerServiceId, webCustomerServiceId);

    await withTenantContext(platformContext(), async (tx) => {
      await crmCompanyRepository.create({ id: companyId, organizationId: platformOrgId, name: `SEO OS Company ${companyId}`, domain: null, industry: null, website: null, phone: null }, tx);
      await crmCompanyRepository.linkToOrganization(companyId, customerOrgAId, tx);
      await serviceDefinitionRepository.create({ id: seoDefinitionId, organizationId: platformOrgId, name: `SEO Retainer ${seoDefinitionId}`, code: `SEO-${seoDefinitionId}`, description: null, category: "SEO", deliveryCadence: "RECURRING", sortOrder: 0 }, tx);
      await serviceDefinitionRepository.create({ id: webDefinitionId, organizationId: platformOrgId, name: `Web Build ${webDefinitionId}`, code: `WEB-${webDefinitionId}`, description: null, category: "WEB_DEVELOPMENT", deliveryCadence: "ONE_TIME", sortOrder: 1 }, tx);
      await customerServiceRepository.create(customerServiceInput(seoCustomerServiceId, seoDefinitionId), tx);
      await customerServiceRepository.create(customerServiceInput(webCustomerServiceId, webDefinitionId), tx);
    });
  });

  afterEach(async () => {
    if (issueIds.length) await db.seoIssue.deleteMany({ where: { id: { in: issueIds } } });
    if (observationIds.length) await db.seoRankObservation.deleteMany({ where: { id: { in: observationIds } } });
    if (auditRunIds.length) await db.seoAuditRun.deleteMany({ where: { id: { in: auditRunIds } } });
    if (importBatchIds.length) await db.seoImportBatch.deleteMany({ where: { id: { in: importBatchIds } } });
    if (keywordIds.length) await db.seoKeyword.deleteMany({ where: { id: { in: keywordIds } } });
    if (propertyIds.length) await db.seoProperty.deleteMany({ where: { id: { in: propertyIds } } });
    if (engagementIds.length) await db.seoEngagement.deleteMany({ where: { id: { in: engagementIds } } });
    if (customerServiceIds.length) await db.customerService.deleteMany({ where: { id: { in: customerServiceIds } } });
    if (definitionIds.length) await db.serviceDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    if (companyIds.length) await db.crmCompany.deleteMany({ where: { id: { in: companyIds } } });
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    if (organizationIds.length) await db.organization.deleteMany({ where: { id: { in: organizationIds } } });
    for (const ids of [issueIds, observationIds, auditRunIds, importBatchIds, keywordIds, propertyIds, engagementIds, customerServiceIds, definitionIds, companyIds, userIds, organizationIds]) ids.length = 0;
  });

  async function createOrganization(name: string): Promise<string> {
    const id = generateId();
    organizationIds.push(id);
    await organizationRepository.create({ id, name, displayName: name, slug: `seo-os-rls-${id}` });
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

  async function createEngagement(customerServiceId = seoCustomerServiceId): Promise<string> {
    const id = generateId();
    engagementIds.push(id);
    await withTenantContext(platformContext(), (tx) => seoEngagementRepository.create({ id, organizationId: platformOrgId, customerServiceId, createdByUserId: platformUserId }, tx));
    return id;
  }

  async function createProperty(engagementId: string, normalizedOrigin = `https://${generateId()}.example.com`): Promise<string> {
    const id = generateId();
    propertyIds.push(id);
    await withTenantContext(platformContext(), (tx) =>
      seoPropertyRepository.create({ id, organizationId: platformOrgId, engagementId, normalizedOrigin, displayUrl: normalizedOrigin, targetCountry: null, targetLocale: null, createdByUserId: platformUserId }, tx),
    );
    return id;
  }

  async function createKeyword(propertyId: string, normalizedPhrase = `keyword ${generateId()}`): Promise<string> {
    const id = generateId();
    keywordIds.push(id);
    await withTenantContext(platformContext(), (tx) =>
      seoKeywordRepository.create({ id, organizationId: platformOrgId, propertyId, phrase: normalizedPhrase, normalizedPhrase, targetUrl: null, searchEngine: "GOOGLE", device: "DESKTOP", country: null, locale: null, tags: [], createdByUserId: platformUserId }, tx),
    );
    return id;
  }

  function issueInput(propertyId: string, overrides: Record<string, unknown> = {}) {
    const now = new Date("2026-09-11T10:00:00.000Z");
    return {
      id: generateId(),
      organizationId: platformOrgId,
      propertyId,
      issueType: "BROKEN_LINK" as const,
      severity: "WARNING" as const,
      pageUrl: null,
      title: "Broken link",
      description: null,
      detectedByAuditRunId: null,
      firstDetectedAt: now,
      lastDetectedAt: now,
      createdByUserId: platformUserId,
      ...overrides,
    };
  }

  async function seedFullGraph(): Promise<SeoGraph> {
    const engagementId = await createEngagement();
    const propertyId = await createProperty(engagementId);
    const keywordId = await createKeyword(propertyId);
    const importBatchId = generateId();
    const observationId = generateId();
    const auditRunId = generateId();
    const issue = issueInput(propertyId, { detectedByAuditRunId: auditRunId });
    importBatchIds.push(importBatchId);
    observationIds.push(observationId);
    auditRunIds.push(auditRunId);
    issueIds.push(issue.id);

    await withTenantContext(platformContext(), async (tx) => {
      await seoImportBatchRepository.create({ id: importBatchId, organizationId: platformOrgId, engagementId, fileName: "seo-os-security.csv", rowCount: 1, importedCount: 1, skippedCount: 0, createdByUserId: platformUserId }, tx);
      await seoRankObservationRepository.create({ id: observationId, organizationId: platformOrgId, keywordId, observedAt: new Date("2026-09-11T08:00:00.000Z"), source: "IMPORT", rankStatus: "RANKED", position: 3, rankingUrl: "https://example.com/page", notes: null, importBatchId, createdByUserId: platformUserId }, tx);
      await seoAuditRunRepository.create({ id: auditRunId, organizationId: platformOrgId, propertyId, source: "MANUAL", status: "COMPLETED", startedAt: new Date("2026-09-11T09:00:00.000Z"), completedAt: new Date("2026-09-11T09:05:00.000Z"), summary: null, createdByUserId: platformUserId }, tx);
      await seoIssueRepository.create(issue as Parameters<typeof seoIssueRepository.create>[0], tx);
    });
    return { engagementId, propertyId, keywordId, importBatchId, observationId, auditRunId, issueId: issue.id };
  }

  async function countsForAllTables(context: TenantContextInput): Promise<Record<(typeof SEO_TABLES)[number], number>> {
    return withTenantContext(context, async (tx) => ({
      seo_engagements: await tx.seoEngagement.count(),
      seo_properties: await tx.seoProperty.count(),
      seo_keywords: await tx.seoKeyword.count(),
      seo_import_batches: await tx.seoImportBatch.count(),
      seo_rank_observations: await tx.seoRankObservation.count(),
      seo_audit_runs: await tx.seoAuditRun.count(),
      seo_issues: await tx.seoIssue.count(),
    }));
  }

  describe("RLS and grants", () => {
    it("fails closed with no tenant context on every SEO table", async () => {
      await seedFullGraph();
      expect(await countsForAllTables(NO_TENANT_CONTEXT)).toEqual(Object.fromEntries(SEO_TABLES.map((table) => [table, 0])));
    });

    it("hides every SEO table from either bare customer-organization context", async () => {
      await seedFullGraph();
      for (const organizationId of [customerOrgAId, customerOrgBId]) {
        const context = { userId: platformUserId, organizationId, isPlatformStaff: false };
        expect(await countsForAllTables(context)).toEqual(Object.fromEntries(SEO_TABLES.map((table) => [table, 0])));
      }
    });

    it("rejects raw DELETE statements against all seven SEO tables", async () => {
      const graph = await seedFullGraph();
      const ids: Record<(typeof SEO_TABLES)[number], string> = {
        seo_engagements: graph.engagementId,
        seo_properties: graph.propertyId,
        seo_keywords: graph.keywordId,
        seo_import_batches: graph.importBatchId,
        seo_rank_observations: graph.observationId,
        seo_audit_runs: graph.auditRunId,
        seo_issues: graph.issueId,
      };
      for (const table of SEO_TABLES) {
        await expectPgError(
          withTenantContext(platformContext(), (tx) => tx.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = $1::uuid`, ids[table])),
          "42501",
          `permission denied for table ${table}`,
        );
      }
    });

    it("rejects raw UPDATE of an append-only rank observation", async () => {
      const graph = await seedFullGraph();
      await expectPgError(
        withTenantContext(platformContext(), (tx) => tx.$executeRaw`UPDATE seo_rank_observations SET notes = 'tampered' WHERE id = ${graph.observationId}::uuid`),
        "42501",
        "permission denied for table seo_rank_observations",
      );
    });
  });

  describe("relationship integrity", () => {
    it("accepts an engagement backed by an SEO-category CustomerService", async () => {
      const id = await createEngagement(seoCustomerServiceId);
      const row = await withTenantContext(platformContext(), (tx) => seoEngagementRepository.findById(id, tx));
      expect(row?.customerServiceId).toBe(seoCustomerServiceId);
    });

    it("rejects an engagement backed by a non-SEO CustomerService with SQLSTATE 23514", async () => {
      const id = generateId();
      engagementIds.push(id);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => seoEngagementRepository.create({ id, organizationId: platformOrgId, customerServiceId: webCustomerServiceId, createdByUserId: platformUserId }, tx)),
        "23514",
        "must use a service definition with category SEO",
      );
    });
  });

  describe("idempotency and uniqueness", () => {
    it("rejects a second engagement for the same CustomerService", async () => {
      await createEngagement();
      const duplicateId = generateId();
      engagementIds.push(duplicateId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => seoEngagementRepository.create({ id: duplicateId, organizationId: platformOrgId, customerServiceId: seoCustomerServiceId, createdByUserId: platformUserId }, tx)),
        "P2002",
      );
    });

    it("rejects a duplicate engagement property origin", async () => {
      const engagementId = await createEngagement();
      const origin = "https://duplicate-origin.example.com";
      await createProperty(engagementId, origin);
      const duplicateId = generateId();
      propertyIds.push(duplicateId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => seoPropertyRepository.create({ id: duplicateId, organizationId: platformOrgId, engagementId, normalizedOrigin: origin, displayUrl: origin, targetCountry: null, targetLocale: null, createdByUserId: platformUserId }, tx)),
        "P2002",
      );
    });

    it("the functional keyword index rejects duplicates when country and locale are both NULL", async () => {
      const propertyId = await createProperty(await createEngagement());
      const phrase = "null dimension duplicate";
      await createKeyword(propertyId, phrase);
      const duplicateId = generateId();
      keywordIds.push(duplicateId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => seoKeywordRepository.create({ id: duplicateId, organizationId: platformOrgId, propertyId, phrase, normalizedPhrase: phrase, targetUrl: null, searchEngine: "GOOGLE", device: "DESKTOP", country: null, locale: null, tags: [], createdByUserId: platformUserId }, tx)),
        "P2002",
      );
    });

    it("rejects a second rank observation for the same keyword and observedAt", async () => {
      const propertyId = await createProperty(await createEngagement());
      const keywordId = await createKeyword(propertyId);
      const observedAt = new Date("2026-09-11T12:00:00.000Z");
      const firstId = generateId();
      observationIds.push(firstId);
      await withTenantContext(platformContext(), (tx) => seoRankObservationRepository.create({ id: firstId, organizationId: platformOrgId, keywordId, observedAt, source: "MANUAL", rankStatus: "RANKED", position: 1, rankingUrl: null, notes: null, importBatchId: null, createdByUserId: platformUserId }, tx));
      const duplicateId = generateId();
      observationIds.push(duplicateId);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => seoRankObservationRepository.create({ id: duplicateId, organizationId: platformOrgId, keywordId, observedAt, source: "MANUAL", rankStatus: "RANKED", position: 2, rankingUrl: null, notes: null, importBatchId: null, createdByUserId: platformUserId }, tx)),
        "P2002",
      );
    });

    it("enforces both issue partial indexes while allowing site-wide and page-scoped rows to coexist", async () => {
      const propertyId = await createProperty(await createEngagement());
      const pageUrl = "https://example.com/broken";
      const sitewide = issueInput(propertyId);
      const page = issueInput(propertyId, { pageUrl });
      issueIds.push(sitewide.id, page.id);
      await withTenantContext(platformContext(), async (tx) => {
        await seoIssueRepository.create(sitewide as Parameters<typeof seoIssueRepository.create>[0], tx);
        await seoIssueRepository.create(page as Parameters<typeof seoIssueRepository.create>[0], tx);
      });

      const visible = await withTenantContext(platformContext(), (tx) => tx.seoIssue.count({ where: { propertyId, issueType: "BROKEN_LINK" } }));
      expect(visible).toBe(2);

      for (const duplicate of [issueInput(propertyId), issueInput(propertyId, { pageUrl })]) {
        issueIds.push(duplicate.id);
        await expectPgError(withTenantContext(platformContext(), (tx) => seoIssueRepository.create(duplicate as Parameters<typeof seoIssueRepository.create>[0], tx)), "P2002");
      }
    });

    it("allows exactly one winner in a real concurrent engagement-creation race", async () => {
      const idA = generateId();
      const idB = generateId();
      engagementIds.push(idA, idB);
      const attempt = (id: string) =>
        withTenantContext(platformContext(), (tx) =>
          seoEngagementRepository
            .create({ id, organizationId: platformOrgId, customerServiceId: seoCustomerServiceId, createdByUserId: platformUserId }, tx)
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
      const keywordId = await createKeyword(await createProperty(await createEngagement()));
      const id = generateId();
      observationIds.push(id);
      await expectPgError(
        withTenantContext(platformContext(), (tx) => seoRankObservationRepository.create({ id, organizationId: platformOrgId, keywordId, observedAt: new Date(), source: "MANUAL", rankStatus, position, rankingUrl: null, notes: null, importBatchId: null, createdByUserId: platformUserId }, tx)),
        "23514",
        "seo_rank_observations_position_consistency_check",
      );
    });

    it("rejects inconsistent resolved metadata", async () => {
      const propertyId = await createProperty(await createEngagement());
      const bad = issueInput(propertyId, { resolvedAt: new Date(), resolvedByUserId: null });
      issueIds.push(bad.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.seoIssue.create({ data: bad as never })), "23514", "seo_issues_resolved_consistency_check");
    });

    it.each([
      ["missing actor", { ignoredAt: new Date(), ignoredByUserId: null, ignoredReason: "accepted risk" }],
      ["blank reason", { ignoredAt: new Date(), ignoredByUserId: "ACTOR", ignoredReason: "   " }],
    ])("rejects ignored metadata with %s", async (_label, overrides) => {
      const propertyId = await createProperty(await createEngagement());
      const bad = issueInput(propertyId, { ...overrides, ...(overrides.ignoredByUserId === "ACTOR" ? { ignoredByUserId: platformUserId } : {}) });
      issueIds.push(bad.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.seoIssue.create({ data: bad as never })), "23514", "seo_issues_ignored_consistency_check");
    });

    it("rejects lastDetectedAt before firstDetectedAt", async () => {
      const propertyId = await createProperty(await createEngagement());
      const bad = issueInput(propertyId, { firstDetectedAt: new Date("2026-09-11T11:00:00.000Z"), lastDetectedAt: new Date("2026-09-11T10:59:59.999Z") });
      issueIds.push(bad.id);
      await expectPgError(withTenantContext(platformContext(), (tx) => tx.seoIssue.create({ data: bad as never })), "23514", "seo_issues_detection_order_check");
    });
  });

  describe("forged organization relationships", () => {
    it("RLS WITH CHECK rejects a mismatched organizationId on every SEO table", async () => {
      const graph = await seedFullGraph();
      const forgedEngagementCustomerServiceId = generateId();
      customerServiceIds.push(forgedEngagementCustomerServiceId);
      await withTenantContext(platformContext(), (tx) => customerServiceRepository.create(customerServiceInput(forgedEngagementCustomerServiceId, seoDefinitionId), tx));
      const attempts: Array<(tx: TenantTransactionClient) => Promise<unknown>> = [
        (tx) => tx.seoEngagement.create({ data: { id: generateId(), organizationId: customerOrgBId, customerServiceId: forgedEngagementCustomerServiceId, createdByUserId: platformUserId } }),
        (tx) => tx.seoProperty.create({ data: { id: generateId(), organizationId: customerOrgBId, engagementId: graph.engagementId, normalizedOrigin: "https://forged.example.com", displayUrl: "https://forged.example.com", createdByUserId: platformUserId } }),
        (tx) => tx.seoKeyword.create({ data: { id: generateId(), organizationId: customerOrgBId, propertyId: graph.propertyId, phrase: "forged", normalizedPhrase: "forged", device: "MOBILE", createdByUserId: platformUserId } }),
        (tx) => tx.seoImportBatch.create({ data: { id: generateId(), organizationId: customerOrgBId, engagementId: graph.engagementId, rowCount: 0, importedCount: 0, skippedCount: 0, createdByUserId: platformUserId } }),
        (tx) => tx.seoRankObservation.create({ data: { id: generateId(), organizationId: customerOrgBId, keywordId: graph.keywordId, observedAt: new Date("2026-09-12T00:00:00.000Z"), source: "MANUAL", rankStatus: "NOT_FOUND", position: null, createdByUserId: platformUserId } }),
        (tx) => tx.seoAuditRun.create({ data: { id: generateId(), organizationId: customerOrgBId, propertyId: graph.propertyId, source: "MANUAL", status: "COMPLETED", startedAt: new Date(), createdByUserId: platformUserId } }),
        (tx) => tx.seoIssue.create({ data: issueInput(graph.propertyId, { id: generateId(), organizationId: customerOrgBId, issueType: "MISSING_TITLE" }) as never }),
      ];
      for (const attempt of attempts) await expectPgError(withTenantContext(platformContext(), attempt), "42501", "row-level security policy");
    });
  });
});
