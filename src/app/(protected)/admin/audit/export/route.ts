import { createRouteHandler } from "@/lib/platform/route-handler";
import { exportPlatformAuditEvents } from "@/lib/audit/query";

export const dynamic = "force-dynamic";

/** Platform-wide CSV export — `audit.exportPlatform`. Same reasoning as the organization export route. */
export const GET = createRouteHandler(async (request) => {
  const url = new URL(request.url);
  const filters = Object.fromEntries(url.searchParams.entries());

  const result = await exportPlatformAuditEvents(filters);

  const filename = `audit-log-platform-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(result.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Audit-Export-Truncated": String(result.truncated),
      "X-Audit-Export-Row-Count": String(result.rowCount),
    },
  });
});
