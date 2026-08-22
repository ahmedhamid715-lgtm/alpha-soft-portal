import "server-only";
import { z } from "zod";
import type { Invoice, InvoiceLineItem } from "@/generated/prisma/client";
import { parseOrThrow, optionalFromQueryParam } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { cursorPaginationSchema, type CursorPaginatedResult } from "@/lib/platform/pagination";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { InvoiceNotFoundError } from "@/lib/billing/errors";
import { ConflictError } from "@/lib/errors/app-error";
import { stripeBillingProvider } from "@/lib/billing/provider/stripe/provider";
import { audit } from "@/lib/audit/service";
import { events } from "@/lib/platform/events";
import { logger } from "@/lib/logging";

const listSchema = z.object({
  organizationId: z.string().uuid(),
  cursor: cursorPaginationSchema.shape.cursor,
  limit: cursorPaginationSchema.shape.limit,
  status: optionalFromQueryParam(z.enum(["DRAFT", "OPEN", "PAID", "VOID", "UNCOLLECTIBLE"])),
});

/** `billing.read` — cursor-paginated (spec §41), never offset. */
export async function listInvoicesForOrganization(rawInput: unknown): Promise<CursorPaginatedResult<Invoice>> {
  const input = parseOrThrow(listSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  return withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    invoiceRepository.listForOrganization(input.organizationId, { cursor: input.cursor, limit: input.limit }, { status: input.status }, tx),
  );
}

const getSchema = z.object({ organizationId: z.string().uuid(), invoiceId: z.string().uuid() });

/**
 * `billing.read` — a specific invoice, WITH its immutable line items.
 * The IDOR boundary (spec §55 Q2): `invoiceId` alone is never sufficient
 * — this only ever reads THROUGH the organization's own tenant context
 * (`withTenantContext()`), so a forged `invoiceId` belonging to another
 * organization resolves to `null` (RLS filters it out before this
 * function's own explicit `invoice.organizationId !== organizationId`
 * check would even run) — both are real, tested defenses, not one
 * relying on the other silently.
 */
export async function getInvoiceForOrganization(rawInput: unknown): Promise<Invoice & { lineItems: InvoiceLineItem[] }> {
  const input = parseOrThrow(getSchema, rawInput);
  const context = await requirePermission("billing.read", input.organizationId);
  const invoice = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => invoiceRepository.findByIdWithLineItems(input.invoiceId, tx),
  );
  if (!invoice || invoice.organizationId !== input.organizationId) throw new InvoiceNotFoundError();
  return invoice;
}

const retrySchema = z.object({ organizationId: z.string().uuid(), invoiceId: z.string().uuid() });

/**
 * Payment failure recovery — the FOUNDATION spec §15 asks for, not a
 * fake retry engine: this exposes Stripe's OWN retry capability
 * (`stripe.invoices.pay()`, one immediate attempt using the customer's
 * current default payment method) and nothing more. There is no
 * schedule, no backoff, no multi-attempt state machine here — Stripe's
 * own subscription dunning settings already own that, and duplicating
 * it would be exactly the "fake retry engine" the spec explicitly warns
 * against.
 *
 * `billing.manage` (owner-only, same as every other consequential
 * customer-initiated billing action) — deliberately NOT platform-staff-
 * only: retrying a payment doesn't move money in any NEW way (it
 * re-attempts the SAME already-authorized invoice), so it's a lower
 * risk tier than a refund and a natural self-service action once a
 * customer has updated their card via the Billing Portal.
 *
 * Like every other mutation in this module, writes NOTHING locally —
 * the actual outcome (paid, or failed again) arrives via the normal
 * `invoice.paid`/`invoice.payment_failed` webhook.
 */
export async function retryInvoicePayment(rawInput: unknown): Promise<void> {
  const input = parseOrThrow(retrySchema, rawInput);
  const context = await requirePermission("billing.manage", input.organizationId);

  const invoice = await withTenantContext(
    { userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff },
    (tx) => invoiceRepository.findByIdWithLineItems(input.invoiceId, tx),
  );
  if (!invoice || invoice.organizationId !== input.organizationId) throw new InvoiceNotFoundError();
  if (invoice.status !== "OPEN") {
    throw new ConflictError("Only an open, unpaid invoice can be retried.");
  }
  if (!invoice.providerInvoiceId) {
    throw new ConflictError("This invoice has no associated provider invoice to retry.");
  }

  await stripeBillingProvider.retryInvoicePayment({ providerInvoiceId: invoice.providerInvoiceId });

  await withTenantContext({ userId: context.user!.id, organizationId: input.organizationId, isPlatformStaff: context.isPlatformStaff }, (tx) =>
    audit.recordSuccess({
      action: "billing.payment.retry_requested",
      organizationId: input.organizationId,
      resourceType: "invoice",
      resourceId: invoice.id,
      tx,
    }),
  );

  logger.info("Invoice payment retry requested.", { operation: "billing.invoice.retry_payment", organizationId: input.organizationId, invoiceId: invoice.id });
  await events.emit("billing.payment.retry_requested", { organizationId: input.organizationId, invoiceId: invoice.id });
}
