import "server-only";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveEcommerceDevScope } from "./ecommerce-shared";
import { customerServiceRepository } from "@/server/repositories/customer-service-repository";
import { ecommerceStoreRepository } from "@/server/repositories/ecommerce-store-repository";
import { ecommerceProductRepository } from "@/server/repositories/ecommerce-product-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { evaluateEcommerceReadiness } from "@/lib/ecommerce/launch-readiness";
import { getWebsiteSiteOverview } from "./website-engagement-service";
import { PermissionDeniedError } from "@/lib/authorization/errors";
import type { EcommerceServicePerformanceInput } from "@/lib/crm/client-success";

/**
 * The ONE safe read Customer 360 / Client Success are allowed to
 * compose E-Commerce Development data through (Build 33 — Roadmap
 * Module 27), mirroring `website-customer-360-service.ts`'s own exact
 * "source domain owns reads" discipline. Resolves its own
 * `ecommerce_development.read` permission internally — Customer 360/
 * Client Success never escalate their own caller's privileges to read
 * E-Commerce Development data they couldn't otherwise see. A FOURTH,
 * SEPARATE domain from SEO OS/Local SEO/Website Dev's own equivalents.
 *
 * Only the customer's ACTIVE E-Commerce Development `CustomerService`
 * engagement(s) count — same "currently relevant work only" philosophy
 * every other Customer 360 specialist input already establishes.
 */
export async function getEcommerceServicePerformanceInputForCustomer360(customerOrganizationId: string): Promise<EcommerceServicePerformanceInput | null> {
  const { tenantScope } = await resolveEcommerceDevScope("ecommerce_development.read");

  return withTenantContext(tenantScope, async (tx) => {
    const customerServices = await customerServiceRepository.listForCustomerOrganization(customerOrganizationId, tx);
    const activeServiceIds = customerServices.filter((cs) => cs.status === "ACTIVE").map((cs) => cs.id);
    if (activeServiceIds.length === 0) return null;

    const definitionIds = [...new Set(customerServices.filter((cs) => activeServiceIds.includes(cs.id)).map((cs) => cs.serviceDefinitionId))];
    const definitions = await tx.serviceDefinition.findMany({ where: { id: { in: definitionIds }, category: "ECOMMERCE" }, select: { id: true } });
    const ecommerceDefinitionIds = new Set(definitions.map((d) => d.id));
    const ecommerceServiceIds = customerServices.filter((cs) => activeServiceIds.includes(cs.id) && ecommerceDefinitionIds.has(cs.serviceDefinitionId)).map((cs) => cs.id);
    if (ecommerceServiceIds.length === 0) return null;

    const engagements = await tx.ecommerceEngagement.findMany({ where: { customerServiceId: { in: ecommerceServiceIds } }, select: { id: true, projectId: true } });
    if (engagements.length === 0) return null;

    const stores = await ecommerceStoreRepository.listForEngagements(
      engagements.map((e) => e.id),
      tx,
    );
    const activeStores = stores.filter((s) => s.status !== "ARCHIVED");
    if (activeStores.length === 0) return null;

    const activeStoreIds = activeStores.map((s) => s.id);
    const productCountsByStore = await ecommerceProductRepository.countsForStores(activeStoreIds, tx);

    let anyReadinessNotReady = false;
    let anyOverdueUnlaunchedStore = false;
    let nearestUpcomingLaunchTargetDate: Date | null = null;
    const now = new Date();

    // Codex Performance Engineer finding PERF-ECOM-03 — the per-store
    // linked-website readiness lookup is a genuine cross-domain call
    // (`getWebsiteSiteOverview()`), so it cannot be folded into the
    // batched `countsForStores()` call above; resolved CONCURRENTLY
    // across every active store instead of one `await` per iteration of
    // the aggregation loop below — same "typically one store" realistic
    // bound this domain documents throughout, but never serialized when
    // there happens to be more than one.
    async function resolveLinkedWebsiteReadiness(store: (typeof activeStores)[number]): Promise<"READY" | "NOT_READY" | null> {
      if (!store.websiteSiteId) return null;
      try {
        const siteOverview = await getWebsiteSiteOverview({ siteId: store.websiteSiteId });
        return siteOverview.readiness.status === "NOT_MEASURABLE" ? null : siteOverview.readiness.status;
      } catch (error) {
        // The acting caller may hold ecommerce_development.read
        // without website_development.read — a genuinely different
        // specialist domain's own permission. Only a permission
        // denial is swallowed here (the linked website's own
        // readiness is simply excluded from THIS store's readiness
        // signal, never fabricated as READY); any OTHER error (a
        // genuine bug, a dangling site reference, a database failure)
        // still propagates rather than being silently hidden.
        if (!(error instanceof PermissionDeniedError)) throw error;
        return null;
      }
    }
    const linkedWebsiteReadinessByStore = new Map(await Promise.all(activeStores.map(async (store) => [store.id, await resolveLinkedWebsiteReadiness(store)] as const)));

    for (const store of activeStores) {
      const productCounts = productCountsByStore.get(store.id);
      const linkedWebsiteReadiness = linkedWebsiteReadinessByStore.get(store.id) ?? null;

      const readiness = evaluateEcommerceReadiness({
        storeExists: true,
        checkoutConfigured: store.checkoutConfigured === "YES",
        paymentConfigured: store.paymentConfigured === "YES",
        requiredProductCount: productCounts?.requiredProductCount ?? 0,
        completedRequiredProductCount: productCounts?.completedRequiredProductCount ?? 0,
        // QA is engagement-scoped (via the linked Project), computed once below — treat as satisfied here to isolate the per-store config/product/website signal only.
        requiredQaCount: 0,
        passedRequiredQaCount: 0,
        linkedWebsiteReadiness,
      });
      if (readiness.status === "NOT_READY") anyReadinessNotReady = true;

      if (store.status !== "LIVE") {
        if (store.launchTargetDate && store.launchTargetDate.getTime() < now.getTime()) anyOverdueUnlaunchedStore = true;
        if (store.launchTargetDate && store.launchTargetDate.getTime() >= now.getTime()) {
          if (!nearestUpcomingLaunchTargetDate || store.launchTargetDate.getTime() < nearestUpcomingLaunchTargetDate.getTime()) nearestUpcomingLaunchTargetDate = store.launchTargetDate;
        }
      }
    }

    // Required QA is engagement-scoped (one Project may deliver several
    // stores) — computed ONCE across every distinct linked project,
    // never per-store (would double count).
    const linkedProjectIds = [...new Set(engagements.map((e) => e.projectId).filter((id): id is string => id !== null))];
    let requiredQaFailedCount = 0;
    let requiredQaPendingCount = 0;
    let linkedProjectStatus: EcommerceServicePerformanceInput["linkedProjectStatus"] = null;
    if (linkedProjectIds.length > 0) {
      const [qaChecks, projects] = await Promise.all([projectQaCheckRepository.listForProjects(linkedProjectIds, tx), tx.project.findMany({ where: { id: { in: linkedProjectIds } }, select: { status: true } })]);
      const requiredQa = qaChecks.filter((q) => q.required);
      requiredQaFailedCount = requiredQa.filter((q) => q.status === "FAILED").length;
      requiredQaPendingCount = requiredQa.filter((q) => q.status === "PENDING").length;
      // Worst project status wins when several projects are linked (a rare case) — same highest-severity-first discipline as everywhere else.
      const severity: Record<string, number> = { CANCELLED: 0, ON_HOLD: 1, DRAFT: 2, PLANNED: 3, ACTIVE: 4, ARCHIVED: 5, COMPLETED: 6 };
      linkedProjectStatus = projects.map((p) => p.status).sort((a, b) => (severity[a] ?? 9) - (severity[b] ?? 9))[0] ?? null;
    }

    return { activeStoreCount: activeStores.length, anyReadinessNotReady, anyOverdueUnlaunchedStore, nearestUpcomingLaunchTargetDate, linkedProjectStatus, requiredQaFailedCount, requiredQaPendingCount };
  });
}
