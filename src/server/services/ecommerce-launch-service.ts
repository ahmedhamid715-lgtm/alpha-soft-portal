import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveEcommerceDevScope } from "./ecommerce-shared";
import { ecommerceStoreRepository } from "@/server/repositories/ecommerce-store-repository";
import { ecommerceEngagementRepository } from "@/server/repositories/ecommerce-engagement-repository";
import { ecommerceProductRepository } from "@/server/repositories/ecommerce-product-repository";
import { projectQaCheckRepository } from "@/server/repositories/project-qa-check-repository";
import { loadEcommerceStoreChecked } from "./ecommerce-engagement-service";
import { getWebsiteSiteOverview } from "./website-engagement-service";
import { evaluateEcommerceReadiness } from "@/lib/ecommerce/launch-readiness";
import { assertNoSecretLikeContent, SuspectedSecretContentError } from "@/lib/security/secret-guard";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { EcommerceStore } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * E-Commerce Development launch recording (Build 33 — Roadmap Module
 * 27). `ecommerce_development.launch` — a deliberately NARROWER tier
 * than `ecommerce_development.manage` (the same `website_development.
 * deploy`-vs-`.manage` split every specialist domain in this codebase
 * already establishes), reflecting that a recorded store launch is an
 * effectively irreversible, customer-facing act.
 *
 * This module records EVIDENCE only — a `status = LIVE` row never
 * implies Alpha OS itself deployed/activated a storefront, connected a
 * payment provider, or performed any live commerce action. See
 * docs/architecture/ecommerce-development-os.md "Launch/live semantics."
 */

interface StoreContext {
  storeId: string;
  engagementId: string;
  customerServiceId: string;
  ownerUserId: string | null;
  companyName: string;
  storeName: string;
}

async function loadStoreContext(storeId: string, organizationId: string, tx: TransactionClient): Promise<StoreContext> {
  const store = await loadEcommerceStoreChecked(storeId, organizationId, tx);
  const engagement = await ecommerceEngagementRepository.findById(store.engagementId, tx);
  if (!engagement) throw new NotFoundError("E-Commerce Development engagement");
  const customerService = await tx.customerService.findUnique({ where: { id: engagement.customerServiceId }, select: { companyId: true, ownerUserId: true } });
  const company = customerService ? await tx.crmCompany.findUnique({ where: { id: customerService.companyId }, select: { name: true } }) : null;
  return {
    storeId,
    engagementId: engagement.id,
    customerServiceId: engagement.customerServiceId,
    ownerUserId: customerService?.ownerUserId ?? null,
    companyName: company?.name ?? "Customer",
    storeName: store.name,
  };
}

function assertFieldsClean(fields: Record<string, string | null | undefined>): void {
  for (const [label, value] of Object.entries(fields)) {
    try {
      assertNoSecretLikeContent(value, label);
    } catch (error) {
      if (error instanceof SuspectedSecretContentError) throw new ValidationError(error.message);
      throw error;
    }
  }
}

const recordLaunchSchema = z.object({
  storeId: z.string().uuid(),
  overrideReason: z.string().trim().max(1000).nullable().optional(),
});

/**
 * The explicit, transactional launch operation. Requires launch
 * readiness (`READY`) UNLESS `overrideReason` is supplied — an override
 * still requires `ecommerce_development.launch` (this codebase's
 * smallest proportionate model) AND is always durably audited with the
 * reason attached — the override audit write happens INSIDE the same
 * transaction as the launch mutation itself (applying Website Dev's own
 * Build 32 Codex Security Engineer finding WDEV-SEC-03 lesson from the
 * start: an audit-persistence failure rolls back the launch rather than
 * silently permitting an unaudited override). Never infers launch
 * merely because a linked website's production URL exists — this is the
 * ONLY path that sets `EcommerceStore.status = LIVE`.
 */
export async function recordEcommerceStoreLaunch(rawInput: unknown): Promise<EcommerceStore> {
  const input = parseOrThrow(recordLaunchSchema, rawInput);
  assertFieldsClean({ "Override reason": input.overrideReason ?? null });
  const { context, tenantScope, organizationId } = await resolveEcommerceDevScope("ecommerce_development.launch");

  const { store, storeContext, wasOverride } = await withTenantContext(tenantScope, async (tx) => {
    const storeContext = await loadStoreContext(input.storeId, organizationId, tx);
    const store = await loadEcommerceStoreChecked(input.storeId, organizationId, tx);
    if (store.status === "LIVE") throw new ConflictError("This store is already recorded as live.");
    // Applying Website Dev's own WDEV-SEC-02 lesson from the start — an
    // archived store must return to an active state ONLY through
    // `reactivateEcommerceStore()`, never launch directly.
    if (store.status === "ARCHIVED") throw new ConflictError("This store is archived. Reactivate it before recording a launch.");

    const engagement = await ecommerceEngagementRepository.findById(store.engagementId, tx);
    const [productCounts, qaChecks] = await Promise.all([
      ecommerceProductRepository.countsForStore(input.storeId, tx),
      engagement?.projectId ? projectQaCheckRepository.listForProject(engagement.projectId, tx) : Promise.resolve([]),
    ]);
    const requiredQa = qaChecks.filter((q) => q.required);
    const passedRequiredQa = requiredQa.filter((q) => q.status === "PASSED" || q.status === "WAIVED");

    let linkedWebsiteReadiness: "READY" | "NOT_READY" | null = null;
    if (store.websiteSiteId) {
      // Deliberately NOT wrapped in a try/catch (contrast with
      // `getEcommerceStoreOverview()`'s own read-only enrichment,
      // which degrades gracefully) — an irreversible launch action must
      // fail closed if the caller cannot independently see the linked
      // website's own readiness, rather than silently proceeding as if
      // no website were linked at all. The caller must hold BOTH
      // `ecommerce_development.launch` AND `website_development.read`
      // to launch a website-linked store — the same "never silently
      // borrow another domain's permission" policy
      // `createAndLinkWebsiteProject()` already establishes.
      const siteOverview = await getWebsiteSiteOverview({ siteId: store.websiteSiteId });
      linkedWebsiteReadiness = siteOverview.readiness.status === "NOT_MEASURABLE" ? null : siteOverview.readiness.status;
    }

    const readiness = evaluateEcommerceReadiness({
      storeExists: true,
      checkoutConfigured: store.checkoutConfigured === "YES",
      paymentConfigured: store.paymentConfigured === "YES",
      requiredProductCount: productCounts.requiredProductCount,
      completedRequiredProductCount: productCounts.completedRequiredProductCount,
      requiredQaCount: requiredQa.length,
      passedRequiredQaCount: passedRequiredQa.length,
      linkedWebsiteReadiness,
    });

    const wasOverride = readiness.status !== "READY";
    if (wasOverride && !input.overrideReason) {
      throw new ValidationError(`This store is not launch-ready: ${readiness.reasons.join(" ")} Provide overrideReason to launch anyway.`);
    }

    const updated = await ecommerceStoreRepository.recordLaunch(input.storeId, new Date(), tx);
    if (!updated) throw new ConflictError("This store was just launched by someone else. Reload and try again.");

    if (wasOverride) {
      await audit.recordSuccess({
        action: "ecommerce.launch_override_recorded",
        organizationId,
        resourceType: "ecommerce_store",
        resourceId: updated.id,
        resourceName: updated.name,
        metadata: { overrideReason: input.overrideReason },
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
        tx,
      });
    }

    return { store: updated, storeContext, wasOverride };
  });

  if (!wasOverride) {
    await audit
      .recordSuccess({
        action: "ecommerce.launch_recorded",
        organizationId,
        resourceType: "ecommerce_store",
        resourceId: store.id,
        resourceName: store.name,
        knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
      })
      .catch((error) => console.error("[audit] failed to record ecommerce.launch_recorded", error));
  }

  if (storeContext.ownerUserId) {
    await events.emit("ecommerce.launch_recorded", { storeId: store.id, engagementId: storeContext.engagementId, organizationId, ownerUserId: storeContext.ownerUserId, storeName: store.name, companyName: storeContext.companyName });
  }

  return store;
}
