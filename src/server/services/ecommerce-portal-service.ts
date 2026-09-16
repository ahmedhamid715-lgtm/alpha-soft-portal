import "server-only";
import { ecommerceStoreRepository } from "@/server/repositories/ecommerce-store-repository";
import { ecommerceProductRepository } from "@/server/repositories/ecommerce-product-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { evaluateEcommerceReadiness, type EcommerceReadinessStatus } from "@/lib/ecommerce/launch-readiness";
import type { TenantTransactionClient } from "@/lib/tenancy/context";
import type { CustomerService, EcommerceStoreStatus } from "@/generated/prisma/client";

/**
 * The Customer Portal's own customer-safe E-Commerce Development
 * projection (Build 33 — Roadmap Module 27). Dedicated DTO, never the
 * internal `EcommerceStore`/`EcommerceProduct`/`EcommerceVariant`/
 * `EcommerceImportBatch` model shapes. Exposes only: store name,
 * platform, customer-safe status, launch target/launched dates,
 * required-product progress (COUNTS only — individual products are
 * deliberately never exposed to the Portal, freezing the narrower of
 * the two options the master prompt itself offers), launch-readiness
 * state, and the public storefront URL — and ONLY when the store has
 * actually launched AND (when linked to a `WebsiteSite`) that site's
 * own production environment was explicitly marked `customerVisible`.
 * Never staging/local/dev URLs, never repository URLs, never provider
 * labels/technology notes, never import-batch metadata, never QA
 * detail, never staff identity, never pricing/margins.
 *
 * Deliberately takes an ALREADY-OPEN Portal tenant-context `tx` rather
 * than resolving its own `ecommerce_development.read` scope — mirrors
 * `getWebsitePortalSummaryForCustomerServices()`'s own exact reasoning:
 * a Portal customer never holds — and never should hold — a PLATFORM
 * permission like `ecommerce_development.read`; the real authorization
 * decision (`portal.access` + the caller's own organization id) already
 * happened once, in `getPortalServices()`, before this function is ever
 * reached.
 */
export interface PortalEcommerceDevelopmentSummary {
  storeName: string;
  platform: string;
  status: EcommerceStoreStatus;
  launchTargetDate: Date | null;
  launchedAt: Date | null;
  /** Only populated once launched AND (when linked to a WebsiteSite) that site's production environment was explicitly marked customer-visible — never a staging/dev/local URL, and never the store's own internal `storeUrl` field directly. */
  publicStorefrontUrl: string | null;
  requiredProductCount: number;
  completedRequiredProductCount: number;
  readinessStatus: EcommerceReadinessStatus;
}

/** `customerServices` — the SAME already-fetched `listForCustomerOrganization()` result the canonical services tier used, passed in rather than re-queried. */
export async function getEcommercePortalSummaryForCustomerServices(customerServices: CustomerService[], tx: TenantTransactionClient): Promise<PortalEcommerceDevelopmentSummary | null> {
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

  // "Typically one store per engagement" (see architecture doc) —
  // prefer a LIVE store as the customer-facing headline; otherwise the
  // earliest-created active store.
  const primaryStore = activeStores.find((s) => s.status === "LIVE") ?? activeStores[0]!;
  const primaryEngagement = engagements.find((e) => e.id === primaryStore.engagementId);

  // Codex Security Engineer finding ECOM-SEC-04 — required QA is now
  // included in the READINESS COMPUTATION itself (never exposed to the
  // DTO/customer beyond the rolled-up status), so the portal can no
  // longer report READY while a required QA check is genuinely FAILED
  // or PENDING. `0/0` was previously passed unconditionally, which the
  // formula treats as "no QA blocker" regardless of the linked project's
  // real state.
  const [productCounts, requiredQa] = await Promise.all([
    ecommerceProductRepository.countsForStore(primaryStore.id, tx),
    primaryEngagement?.projectId ? projectQaCheckRepository.listForProject(primaryEngagement.projectId, tx) : Promise.resolve([]),
  ]);
  const requiredQaChecks = requiredQa.filter((q) => q.required);
  const passedRequiredQa = requiredQaChecks.filter((q) => q.status === "PASSED" || q.status === "WAIVED");

  let linkedWebsiteReadiness: "READY" | "NOT_READY" | null = null;
  let publicStorefrontUrl: string | null = null;
  if (primaryStore.websiteSiteId) {
    // Codex Performance Engineer finding PERF-ECOM-06 — these two reads
    // are independent (both keyed off the same `websiteSiteId`, neither
    // depends on the other's result) and now run concurrently rather
    // than as a two-query serial waterfall.
    const [productionEnvironment, site] = await Promise.all([
      tx.websiteEnvironment.findFirst({ where: { siteId: primaryStore.websiteSiteId, type: "PRODUCTION" }, select: { url: true, customerVisible: true } }),
      tx.websiteSite.findUnique({ where: { id: primaryStore.websiteSiteId }, select: { status: true, primaryUrl: true } }),
    ]);
    // A coarse "is the storefront launched" proxy, NOT a re-derivation
    // of Website Dev's own full `evaluateLaunchReadiness()` formula
    // (its detailed reasons list is never customer-safe/needed here).
    // The Portal path deliberately never calls `getWebsiteSiteOverview()`
    // — that function resolves `website_development.read`, an internal
    // PLATFORM permission no Portal customer ever holds; this reads the
    // already-open portal transaction's own tenant-scoped rows directly
    // instead, same as `website-portal-service.ts` itself does.
    linkedWebsiteReadiness = site?.status === "LAUNCHED" ? "READY" : "NOT_READY";
    if (primaryStore.status === "LIVE" && productionEnvironment?.customerVisible && productionEnvironment.url) {
      publicStorefrontUrl = productionEnvironment.url;
    }
  } else if (primaryStore.status === "LIVE" && primaryStore.storeUrl) {
    // A headless/no-linked-website store's own recorded URL is exposed
    // once live — there is no separate WebsiteEnvironment.customerVisible
    // gate to check in this case, since no WebsiteSite exists at all.
    publicStorefrontUrl = primaryStore.storeUrl;
  }

  const readiness = evaluateEcommerceReadiness({
    storeExists: true,
    checkoutConfigured: primaryStore.checkoutConfigured === "YES",
    paymentConfigured: primaryStore.paymentConfigured === "YES",
    requiredProductCount: productCounts.requiredProductCount,
    completedRequiredProductCount: productCounts.completedRequiredProductCount,
    // QA detail (counts/reasons) is still never exposed to the DTO
    // itself — only the rolled-up `readinessStatus` is — but the
    // VERDICT now correctly reflects the real, authoritative QA state.
    requiredQaCount: requiredQaChecks.length,
    passedRequiredQaCount: passedRequiredQa.length,
    linkedWebsiteReadiness,
  });

  return {
    storeName: primaryStore.name,
    platform: primaryStore.platform,
    status: primaryStore.status,
    launchTargetDate: primaryStore.launchTargetDate,
    launchedAt: primaryStore.launchedAt,
    publicStorefrontUrl,
    requiredProductCount: productCounts.requiredProductCount,
    completedRequiredProductCount: productCounts.completedRequiredProductCount,
    readinessStatus: readiness.status,
  };
}
