import { createRouteHandler } from "@/lib/platform/route-handler";
import { exportOrganizationAuditEvents } from "@/lib/audit/query";

export const dynamic = "force-dynamic";

/**
 * CSV export (Phase 19) — `audit.export`, same query path and filters as
 * the list page (no separate, less-audited code path; `query.ts`'s
 * `exportOrganizationAuditEvents()` re-checks the permission itself, the
 * page's own "Export CSV" link being visible is not the security
 * boundary). Hard-capped row count; the export itself is recorded as
 * `audit.export.created`. Returns the file directly rather than going
 * through `apiSuccess()` — this is a download, not a JSON API response —
 * `createRouteHandler()` still gives it request-id/error-shape handling
 * for free (a `PermissionDeniedError` here becomes a real 403 JSON body,
 * not an HTML page).
 */
export const GET = createRouteHandler<{ id: string }>(async (request, { params }) => {
  const { id } = await params;
  const url = new URL(request.url);
  const filters = Object.fromEntries(url.searchParams.entries());

  const result = await exportOrganizationAuditEvents({ organizationId: id, ...filters });

  const filename = `audit-log-${id}-${new Date().toISOString().slice(0, 10)}.csv`;
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
