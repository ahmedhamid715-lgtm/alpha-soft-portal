import { createRouteHandler } from "@/lib/platform/route-handler";
import { NotFoundError } from "@/lib/errors/app-error";
import {
  exportPlatformInvoices,
  exportPlatformPayments,
  exportPlatformRefunds,
  exportPlatformCredits,
  exportPlatformAging,
  exportPlatformMrr,
} from "@/server/services/billing-export-service";

export const dynamic = "force-dynamic";

/**
 * One dynamic route for every platform-wide billing report export
 * (spec §12) rather than six near-identical route files — `[type]`
 * dispatches to the corresponding `billing-export-service.ts` function,
 * which independently enforces `billing.reports.export` and applies
 * `withTenantContext({isPlatformStaff: true})` itself; this route is a
 * thin adapter (spec §31: business logic stays in the service layer),
 * never a bypass of that authorization.
 */
const STREAMING_REPORTS = new Set(["invoices", "payments", "refunds", "credits"]);
const AGGREGATE_REPORTS = new Set(["aging", "mrr"]);

export const GET = createRouteHandler<{ type: string }>(async (request, { params }) => {
  const { type } = await params;
  const url = new URL(request.url);
  const periodStart = url.searchParams.get("periodStart") ?? undefined;
  const periodEnd = url.searchParams.get("periodEnd") ?? undefined;
  const filename = `billing-${type}-platform-${new Date().toISOString().slice(0, 10)}.csv`;
  const headers = { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"` };

  if (STREAMING_REPORTS.has(type)) {
    const input = { periodStart, periodEnd };
    const stream =
      type === "invoices" ? await exportPlatformInvoices(input) :
      type === "payments" ? await exportPlatformPayments(input) :
      type === "refunds" ? await exportPlatformRefunds(input) :
      await exportPlatformCredits(input);
    return new Response(stream, { status: 200, headers });
  }

  if (AGGREGATE_REPORTS.has(type)) {
    const csv = type === "aging" ? await exportPlatformAging() : await exportPlatformMrr();
    return new Response(csv, { status: 200, headers });
  }

  throw new NotFoundError("Report type");
});
