import "server-only";
import { z } from "zod";
import type { Invoice, InvoiceLineItem } from "@/generated/prisma/client";
import { parseOrThrow, optionalFromQueryParam } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { cursorPaginationSchema, type CursorPaginatedResult } from "@/lib/platform/pagination";
import { invoiceRepository } from "@/server/repositories/invoice-repository";
import { InvoiceNotFoundError } from "@/lib/billing/errors";

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
