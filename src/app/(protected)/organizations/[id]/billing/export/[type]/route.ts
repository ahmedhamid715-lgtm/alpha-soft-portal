import { createRouteHandler } from "@/lib/platform/route-handler";
import { NotFoundError } from "@/lib/errors/app-error";
import { exportOrganizationInvoices, exportOrganizationPayments, exportOrganizationRefunds, exportOrganizationCredits } from "@/server/services/billing-export-service";

export const dynamic = "force-dynamic";

/**
 * An organization's own billing report exports (spec §12) —
 * `billing.read`, enforced by the service layer, never this thin route.
 * Deliberately just the four ROW-LEVEL reports (invoices/payments/
 * refunds/credits) — AR aging and MRR are platform-only exports
 * (`/admin/billing/export/[type]`): a single organization's own AR
 * aging is just its own open-invoice list (already fully visible on its
 * own invoice page) and its own "MRR" is just its own recurring
 * subscription amount (already shown on its billing dashboard) — a
 * dedicated CSV for either would be speculative infrastructure with no
 * real use case this module could identify, so it wasn't built (spec
 * §29's own instruction).
 */
const REPORTS = new Set(["invoices", "payments", "refunds", "credits"]);

export const GET = createRouteHandler<{ id: string; type: string }>(async (request, { params }) => {
  const { id, type } = await params;
  if (!REPORTS.has(type)) throw new NotFoundError("Report type");

  const url = new URL(request.url);
  const input = { organizationId: id, periodStart: url.searchParams.get("periodStart") ?? undefined, periodEnd: url.searchParams.get("periodEnd") ?? undefined };
  const filename = `billing-${type}-${id}-${new Date().toISOString().slice(0, 10)}.csv`;
  const headers = { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` };

  const stream =
    type === "invoices" ? await exportOrganizationInvoices(input) :
    type === "payments" ? await exportOrganizationPayments(input) :
    type === "refunds" ? await exportOrganizationRefunds(input) :
    await exportOrganizationCredits(input);

  return new Response(stream, { status: 200, headers });
});
