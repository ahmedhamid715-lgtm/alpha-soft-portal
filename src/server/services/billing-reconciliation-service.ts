import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { logger } from "@/lib/logging";
import { audit } from "@/lib/audit/service";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { subscriptionRepository } from "@/server/repositories/subscription-repository";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import type { AuthorizationContext } from "@/lib/authorization/context";

/**
 * Reconciliation (spec §39) — the foundation for DETECTING divergence
 * between Alpha OS and Stripe, never a silent auto-repair. `billing-
 * webhook-service.ts` is still the ONLY writer of subscription state
 * (unchanged from Module 13/14's own architecture) — this service reads
 * BOTH sides and reports a diff; a human (or a future, explicitly-
 * scoped repair action) decides what to do with it. See
 * `billing-reconciliation.md` for the full model and "what automatic
 * repair would require but this module deliberately does not
 * implement."
 */

export interface SubscriptionDivergence {
  field: "status" | "cancelAtPeriodEnd" | "currentPeriodEnd";
  local: string;
  remote: string;
}

export interface OrganizationReconciliationResult {
  organizationId: string;
  checkedAt: Date;
  hasBillingAccount: boolean;
  hasLocalSubscription: boolean;
  hasRemoteSubscription: boolean;
  /** Empty array = no divergence detected. `null` when there's nothing to compare (no local AND no remote subscription — not itself a divergence). */
  divergences: SubscriptionDivergence[] | null;
}

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/**
 * Records `billing.reconciliation.divergence_detected` — deliberately
 * only for a REAL divergence, never a routine "no divergence" check
 * (see the catalog entry's own reasoning, mirroring
 * `billing.webhook.processed`'s reserved-entry discipline). Best-effort:
 * a logging failure here must never turn a successful reconciliation
 * read into a thrown error for the caller.
 */
async function auditDivergence(context: AuthorizationContext, organizationId: string, subscriptionId: string, fields: string[]): Promise<void> {
  await audit
    .recordSuccess({
      action: "billing.reconciliation.divergence_detected",
      organizationId,
      resourceType: "subscription",
      resourceId: subscriptionId,
      metadata: { fields },
      knownActor: context.user ? { userId: context.user.id, displayName: context.user.name } : undefined,
    })
    .catch((error) => console.error("[audit] failed to record billing.reconciliation.divergence_detected", error));
}

/**
 * `billing.readPlatform` — read-only, platform-wide diagnostic. Never
 * mutates `Subscription`/`BillingAccount`; a divergence is reported,
 * not resolved (spec §39: "if automatic repair is implemented, require
 * explicit safe rules" — none exist yet in this module, so none run).
 */
export async function reconcileOrganizationBilling(rawInput: unknown): Promise<OrganizationReconciliationResult> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("billing.readPlatform");

  const account = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    billingAccountRepository.findByOrganizationId(input.organizationId, tx),
  );
  if (!account) {
    return { organizationId: input.organizationId, checkedAt: new Date(), hasBillingAccount: false, hasLocalSubscription: false, hasRemoteSubscription: false, divergences: null };
  }

  const localSubscription = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );

  if (!localSubscription || !localSubscription.providerSubscriptionId) {
    return { organizationId: input.organizationId, checkedAt: new Date(), hasBillingAccount: true, hasLocalSubscription: false, hasRemoteSubscription: false, divergences: null };
  }

  const remote = await stripeBillingProvider.getSubscription(localSubscription.providerSubscriptionId);
  if (!remote) {
    // Alpha OS has a subscription; Stripe has no matching object at all
    // — a genuine, actionable divergence (spec §39's own literal
    // example: "Stripe has subscription / Alpha OS missing it,"
    // mirrored the other direction here).
    logger.warn("Reconciliation: local subscription has no matching Stripe subscription.", {
      operation: "billing.reconciliation.missing_remote",
      organizationId: input.organizationId,
      subscriptionId: localSubscription.id,
      providerSubscriptionId: localSubscription.providerSubscriptionId,
    });
    await auditDivergence(context, input.organizationId, localSubscription.id, ["status"]);
    return {
      organizationId: input.organizationId,
      checkedAt: new Date(),
      hasBillingAccount: true,
      hasLocalSubscription: true,
      hasRemoteSubscription: false,
      divergences: [{ field: "status", local: localSubscription.status, remote: "(not found)" }],
    };
  }

  const divergences: SubscriptionDivergence[] = [];
  if (localSubscription.status !== remote.status) {
    divergences.push({ field: "status", local: localSubscription.status, remote: remote.status });
  }
  if (localSubscription.cancelAtPeriodEnd !== remote.cancelAtPeriodEnd) {
    divergences.push({ field: "cancelAtPeriodEnd", local: String(localSubscription.cancelAtPeriodEnd), remote: String(remote.cancelAtPeriodEnd) });
  }
  const localPeriodEnd = localSubscription.currentPeriodEnd?.getTime() ?? null;
  const remotePeriodEnd = remote.currentPeriodEnd !== null ? remote.currentPeriodEnd * 1000 : null;
  if (localPeriodEnd !== remotePeriodEnd) {
    divergences.push({
      field: "currentPeriodEnd",
      local: localSubscription.currentPeriodEnd?.toISOString() ?? "(none)",
      remote: remote.currentPeriodEnd !== null ? new Date(remote.currentPeriodEnd * 1000).toISOString() : "(none)",
    });
  }

  if (divergences.length > 0) {
    const fields = divergences.map((d) => d.field);
    logger.warn("Reconciliation: divergence detected between Alpha OS and Stripe.", {
      operation: "billing.reconciliation.divergence",
      organizationId: input.organizationId,
      subscriptionId: localSubscription.id,
      fields,
    });
    await auditDivergence(context, input.organizationId, localSubscription.id, fields);
  }

  return {
    organizationId: input.organizationId,
    checkedAt: new Date(),
    hasBillingAccount: true,
    hasLocalSubscription: true,
    hasRemoteSubscription: true,
    divergences,
  };
}
