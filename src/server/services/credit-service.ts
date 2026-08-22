import "server-only";
import { z } from "zod";
import type { CreditLedgerEntry } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { events } from "@/lib/platform/events";
import { logger } from "@/lib/logging";
import { audit } from "@/lib/audit/service";
import { billingAccountRepository } from "@/server/repositories/billing-account-repository";
import { creditLedgerRepository } from "@/server/repositories/credit-ledger-repository";
import { subscriptionRepository } from "@/server/repositories/subscription-repository";
import { computeCreditBalance } from "@/lib/billing/ledger";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import { BillingAccountInvalidError, SubscriptionChangeRejectedError } from "@/lib/billing/errors";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors/app-error";

/**
 * Credit and trial operations (Module 14 spec §6/§11) — built AROUND
 * Module 13's own append-only `CreditLedgerEntry` model, never
 * replacing its own principle: no row is ever updated or deleted here.
 * Both mutation surfaces in this file are `billing.credit.manage`
 * (PLATFORM-scope, `platform_admin`+ — see permissions.ts's own
 * reasoning for why credits/trial extensions share one permission).
 */

const orgIdSchema = z.object({ organizationId: z.string().uuid() });

/** `billing.read` — computed fresh from the ledger on every call (spec §11/§14: never a cached balance). */
export async function getCreditBalance(rawInput: unknown): Promise<{ balance: number; currency: string | null; entries: CreditLedgerEntry[] }> {
  const input = parseOrThrow(orgIdSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);

  const entries = await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    creditLedgerRepository.listForOrganization(input.organizationId, tx),
  );
  return { balance: computeCreditBalance(entries), currency: entries[0]?.currency ?? null, entries };
}

const issueCreditSchema = z.object({
  organizationId: z.string().uuid(),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  reason: z.string().min(1).max(500),
});

/**
 * Issues a `CREDIT` entry (spec §11) — platform-staff-only, never
 * customer self-service (the same "platform decides, customer never
 * grants themself value" discipline `billing.refund` already
 * establishes for the identical risk class — see billing-security.md).
 */
export async function issueCredit(rawInput: unknown): Promise<CreditLedgerEntry> {
  const input = parseOrThrow(issueCreditSchema, rawInput);
  const context = await requirePermission("billing.credit.manage");

  const account = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    billingAccountRepository.findByOrganizationId(input.organizationId, tx),
  );
  if (!account) throw new BillingAccountInvalidError("This organization has no billing account.");
  if (input.currency.toUpperCase() !== account.currency) {
    throw new ValidationError("Credit currency must match the organization's billing currency.", { details: { field: "currency" } });
  }

  const entry = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, async (tx) => {
    const row = await creditLedgerRepository.create(
      {
        id: generateId(),
        organizationId: input.organizationId,
        billingAccountId: account.id,
        type: "CREDIT",
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        reason: input.reason,
        initiatedByUserId: context.user!.id,
      },
      tx,
    );
    await audit.recordSuccess({
      action: "billing.credit.issued",
      organizationId: input.organizationId,
      resourceType: "credit_ledger_entry",
      resourceId: row.id,
      newState: { amount: row.amount, currency: row.currency, reason: row.reason },
      tx,
    });
    return row;
  });

  logger.info("Credit issued.", { operation: "billing.credit.issue", organizationId: input.organizationId, entryId: entry.id, amount: input.amount, issuedByUserId: context.user!.id });
  await events.emit("billing.credit.issued", { organizationId: input.organizationId, entryId: entry.id, amount: input.amount, currency: entry.currency });
  return entry;
}

const adjustCreditSchema = z.object({ organizationId: z.string().uuid(), entryId: z.string().uuid(), reason: z.string().min(1).max(500) });

/**
 * Reverses an earlier ledger entry via a COMPENSATING entry (spec §11:
 * "NOT: UPDATE original row") — a `DEBIT` compensating a `CREDIT`, or a
 * `CREDIT` compensating a `DEBIT`, same amount, linked via
 * `relatedEntryId`. `@@unique([relatedEntryId])` (schema.prisma) is the
 * REAL concurrency guarantee — two simultaneous adjustment attempts
 * against the same original entry: exactly one INSERT succeeds, the
 * other fails the constraint and surfaces as a clean `ConflictError`.
 * Proven under real concurrency — see `credit-concurrency.test.ts`.
 */
export async function adjustCredit(rawInput: unknown): Promise<CreditLedgerEntry> {
  const input = parseOrThrow(adjustCreditSchema, rawInput);
  const context = await requirePermission("billing.credit.manage");

  const original = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    creditLedgerRepository.findById(input.entryId, tx),
  );
  if (!original || original.organizationId !== input.organizationId) throw new NotFoundError("Credit ledger entry");
  if (original.relatedEntryId) {
    throw new ValidationError("A compensating entry cannot itself be adjusted — adjust the original entry instead.", { details: { field: "entryId" } });
  }

  try {
    const entry = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, async (tx) => {
      const row = await creditLedgerRepository.create(
        {
          id: generateId(),
          organizationId: input.organizationId,
          billingAccountId: original.billingAccountId,
          type: original.type === "CREDIT" ? "DEBIT" : "CREDIT",
          amount: original.amount,
          currency: original.currency,
          reason: input.reason,
          relatedEntryId: original.id,
          initiatedByUserId: context.user!.id,
        },
        tx,
      );
      await audit.recordSuccess({
        action: "billing.credit.adjusted",
        organizationId: input.organizationId,
        resourceType: "credit_ledger_entry",
        resourceId: row.id,
        previousState: { originalEntryId: original.id, originalType: original.type, originalAmount: original.amount },
        newState: { type: row.type, amount: row.amount, reason: row.reason },
        tx,
      });
      return row;
    });

    logger.info("Credit adjustment recorded.", { operation: "billing.credit.adjust", organizationId: input.organizationId, originalEntryId: original.id, adjustmentEntryId: entry.id });
    await events.emit("billing.credit.adjusted", { organizationId: input.organizationId, originalEntryId: original.id, entryId: entry.id });
    return entry;
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      throw new ConflictError("This entry has already been adjusted.");
    }
    throw error;
  }
}

const extendTrialSchema = z.object({
  organizationId: z.string().uuid(),
  // A whole number of additional days, bounded to something a platform
  // staff member could plausibly grant in one action — a 400-day
  // "extension" is almost certainly a mistake, not a business decision
  // (spec §6: "prevent negative trial duration... unauthorized trial
  // extensions").
  additionalDays: z.number().int().min(1).max(90),
  reason: z.string().min(1).max(500),
});

/**
 * Extends a TRIALING subscription's trial end date (spec §6) —
 * platform-staff-only. The new `trialEnd` is written to STRIPE first
 * (`extendTrial()`); Alpha OS's own `Subscription.trialEnd` only
 * updates once the resulting `customer.subscription.updated` webhook
 * reconciles it (same "Stripe owns provider state" principle every
 * other subscription mutation in this codebase already follows — this
 * function never writes `trialEnd` locally itself).
 */
export async function extendTrial(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(extendTrialSchema, rawInput);
  const context = await requirePermission("billing.credit.manage");

  const subscription = await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    subscriptionRepository.findCurrentForOrganization(input.organizationId, tx),
  );
  if (!subscription || !subscription.providerSubscriptionId) {
    throw new SubscriptionChangeRejectedError("This organization has no subscription to extend a trial on.");
  }
  // Not a new state-machine ACTION of its own — extending a trial is
  // only ever valid while genuinely TRIALING, which
  // `validateSubscriptionTransition()`'s own table already encodes
  // indirectly (every action it allows FROM `TRIALING` presupposes the
  // subscription is still in that state); re-used here as a direct,
  // explicit status check instead of inventing a table entry for a
  // single-state precondition.
  if (subscription.status !== "TRIALING") {
    throw new SubscriptionChangeRejectedError("This subscription is not currently in a trial.");
  }
  if (!subscription.trialEnd) {
    throw new SubscriptionChangeRejectedError("This subscription has no trial end date to extend.");
  }

  const newTrialEnd = new Date(subscription.trialEnd.getTime() + input.additionalDays * 24 * 60 * 60 * 1000);
  await stripeBillingProvider.extendTrial({ providerSubscriptionId: subscription.providerSubscriptionId, newTrialEndUnixSeconds: Math.floor(newTrialEnd.getTime() / 1000) });

  await withTenantContext({ userId: null, organizationId: input.organizationId, isPlatformStaff: true }, (tx) =>
    audit.recordSuccess({
      action: "billing.trial.extended",
      organizationId: input.organizationId,
      resourceType: "subscription",
      resourceId: subscription.id,
      previousState: { trialEnd: subscription.trialEnd },
      newState: { trialEnd: newTrialEnd, additionalDays: input.additionalDays, reason: input.reason },
      tx,
    }),
  );

  logger.info("Trial extended.", { operation: "billing.trial.extend", organizationId: input.organizationId, subscriptionId: subscription.id, additionalDays: input.additionalDays, extendedByUserId: context.user!.id });
  await events.emit("billing.trial.extended", { organizationId: input.organizationId, subscriptionId: subscription.id, newTrialEnd: newTrialEnd.toISOString() });
}
