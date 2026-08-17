import "server-only";
import { z } from "zod";
import type { AuditCategory, AuditEvent, AuditOutcome } from "@/generated/prisma/client";
import { parseOrThrow, optionalFromQueryParam } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { auditEventRepository, type AuditEventFilter } from "@/server/repositories/audit-event-repository";
import type { CursorPaginatedResult } from "@/lib/platform/pagination";
import { withTenantContext } from "@/lib/tenancy/context";
import type { AuthorizationContext } from "@/lib/authorization/context";
import { PermissionDeniedError } from "@/lib/authorization/errors";
import { audit } from "./service";

/**
 * The audit read/query service (Module 08, spec Phase 15) — the ONLY
 * path the UI (or a future API) uses to read `AuditEvent` rows. Reuses
 * `lib/platform/pagination.ts` verbatim (capped page size, opt-in
 * `totalCount`) — no ad hoc pagination. Every filter that touches
 * `organizationId` is derived from a server-verified
 * `AuthorizationContext`, never a raw client parameter used directly —
 * see "Platform vs. organization audit" in audit-system.md for why
 * these are two structurally separate functions, not one query with an
 * `isPlatformStaff` bypass flag.
 */

const filterSchema = z.object({
  actorUserId: optionalFromQueryParam(z.string().uuid()),
  action: optionalFromQueryParam(z.string().max(200)),
  category: optionalFromQueryParam(z.string()),
  outcome: optionalFromQueryParam(z.string()),
  resourceType: optionalFromQueryParam(z.string().max(100)),
  resourceId: optionalFromQueryParam(z.string().uuid()),
  requestId: optionalFromQueryParam(z.string().max(200)),
  correlationId: optionalFromQueryParam(z.string().max(200)),
  createdAfter: optionalFromQueryParam(z.coerce.date()),
  createdBefore: optionalFromQueryParam(z.coerce.date()),
  search: optionalFromQueryParam(z.string().max(200)),
});
export type AuditQueryFilterInput = z.infer<typeof filterSchema>;

const listSchema = z.object({
  organizationId: z.string().uuid(),
  cursor: optionalFromQueryParam(z.string().uuid()),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).merge(filterSchema);

function toRepositoryFilter(input: AuditQueryFilterInput): Omit<AuditEventFilter, "organizationId" | "organizationIdIn"> {
  return {
    actorUserId: input.actorUserId,
    action: input.action,
    category: input.category && isValidCategory(input.category) ? input.category : undefined,
    outcome: input.outcome && isValidOutcome(input.outcome) ? input.outcome : undefined,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    requestId: input.requestId,
    correlationId: input.correlationId,
    createdAfter: input.createdAfter,
    createdBefore: input.createdBefore,
    search: input.search,
  };
}

const CATEGORIES: AuditCategory[] = ["AUTHENTICATION", "AUTHORIZATION", "ORGANIZATION", "MEMBERSHIP", "INVITATION", "ROLE", "SECURITY", "DATA", "SYSTEM", "ADMINISTRATION", "COMPLIANCE"];
const OUTCOMES: AuditOutcome[] = ["SUCCESS", "FAILURE", "DENIED"];
function isValidCategory(value: string): value is AuditCategory { return (CATEGORIES as string[]).includes(value); }
function isValidOutcome(value: string): value is AuditOutcome { return (OUTCOMES as string[]).includes(value); }

/** Module 06 — every read below runs inside `withTenantContext()`, using the `AuthorizationContext` `requirePermission()` already independently verified. Without this, the RLS policies `audit-rls.test.ts` proves exist would never actually be evaluated for a real read — `requirePermission()` alone would be the ONLY defense, contradicting this module's own documented "two independent layers" (audit-system.md "Tenant isolation"). Same reasoning `role-service.ts`'s `tenantInputFor()` documents. */
function tenantInputFor(context: AuthorizationContext) {
  return { userId: context.user!.id, organizationId: context.organizationId, isPlatformStaff: context.isPlatformStaff };
}

/** This organization's own audit trail — `audit.read`, ORGANIZATION-scoped. A caller with no real membership in `organizationId` gets an `AuthorizationError`, the same as every other Module 07 query. Cursor-paginated — see the repository's own `list()` comment for why. */
export async function listOrganizationAuditEvents(rawInput: unknown): Promise<CursorPaginatedResult<AuditEvent>> {
  const input = parseOrThrow(listSchema, rawInput);
  const context = await requirePermission("audit.read", input.organizationId);

  return withTenantContext(tenantInputFor(context), (tx) =>
    auditEventRepository.list(
      { cursor: input.cursor, limit: input.limit },
      { organizationId: input.organizationId, ...toRepositoryFilter(input) },
      tx,
    ),
  );
}

const platformListSchema = z.object({
  cursor: optionalFromQueryParam(z.string().uuid()),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).merge(filterSchema);

/**
 * Platform-wide audit events — `audit.readPlatform`, PLATFORM-scoped.
 * Scope is `organizationId IS NULL` (true platform-wide events) **plus**
 * the platform organization's own id — never an arbitrary customer
 * organization. This is the actual implementation of "platform admin is
 * not unlimited access to all customer audit data": the query itself is
 * structurally incapable of asking for another organization's rows,
 * regardless of what a client sends.
 */
export async function listPlatformAuditEvents(rawInput: unknown): Promise<CursorPaginatedResult<AuditEvent>> {
  const input = parseOrThrow(platformListSchema, rawInput);
  const context = await requirePermission("audit.readPlatform");

  const platformOrg = await organizationRepository.findPlatformOrganization();
  const organizationIdIn = [null, platformOrg?.id ?? null].filter((v, i, arr) => arr.indexOf(v) === i);

  return withTenantContext(tenantInputFor(context), (tx) =>
    auditEventRepository.list({ cursor: input.cursor, limit: input.limit }, { organizationIdIn, ...toRepositoryFilter(input) }, tx),
  );
}

/**
 * A single event's full detail — re-checks the same organization
 * boundary as the list query (never trust that "the list only showed
 * authorized rows" implies the detail fetch is safe too).
 *
 * The initial `findById()` runs on the plain, non-RLS-protected `db` —
 * same reasoning `role-service.ts`'s `assignRole()` documents for its
 * own initial membership lookup: it only discovers WHICH organization to
 * check permission against, and grants nothing by itself. This is
 * structurally necessary here, not just convenient — until this row is
 * read, its `organizationId` (and therefore which tenant context could
 * even SELECT it under RLS) is unknown, so there is no context to open
 * `withTenantContext()` with yet. `requirePermission()` below is the
 * real, independent authorization gate; a caller who fails it never
 * receives the row this lookup found.
 *
 * `organizationId`, when supplied (the org-scoped detail page always
 * passes its own URL segment), is an EXPECTATION, not a trust boundary
 * by itself — if the real event belongs to a different organization,
 * this returns `null` (treated identically to "no such event") before
 * ever calling `requirePermission()` against that other organization.
 *
 * More generally: a `PermissionDeniedError` from the `requirePermission()`
 * calls below is caught and turned into `null`, not re-thrown — a
 * PLATFORM caller (`audit.readPlatform`) who does not separately hold
 * ORGANIZATION-scope `audit.read` for a real customer org's event hits
 * exactly the same case guessing an id directly under `/admin/audit/`.
 * Without catching it, either caller would crash the whole page with an
 * unhandled 500 instead of the clean 404 every other IDOR case in this
 * codebase presents — the underlying data was never at risk either way
 * (a 500 error page shows nothing), but the *failure mode* matters:
 * "looks like NotFound, not a crash" is this codebase's own established
 * enumeration-avoidance convention (see `password-reset-service.ts`,
 * invitation acceptance). An `AuthenticationError` (no session at all —
 * a different problem than "insufficient permission") is deliberately
 * NOT caught here and still propagates normally. Found via real
 * adversarial E2E tests constructing exactly these URL shapes (Phase
 * 30), not by inspection.
 */
export async function getAuditEventDetail(rawInput: unknown): Promise<AuditEvent | null> {
  const schema = z.object({ id: z.string().uuid(), organizationId: z.string().uuid().optional() });
  const input = parseOrThrow(schema, rawInput);

  const event = await auditEventRepository.findById(input.id);
  if (!event) return null;
  if (input.organizationId !== undefined && event.organizationId !== input.organizationId) return null;

  try {
    if (event.organizationId) {
      await requirePermission("audit.read", event.organizationId);
    } else {
      await requirePermission("audit.readPlatform");
    }
  } catch (error) {
    if (error instanceof PermissionDeniedError) return null;
    throw error;
  }
  return event;
}

const MAX_EXPORT_ROWS = 5000;

export interface AuditExportResult {
  csv: string;
  rowCount: number;
  truncated: boolean;
}

async function runExport(
  context: AuthorizationContext,
  filter: AuditEventFilter,
  auditOrganizationId: string | null,
  repositoryFilterInput: AuditQueryFilterInput,
): Promise<AuditExportResult> {
  const rows = await withTenantContext(tenantInputFor(context), (tx) => auditEventRepository.listForExport(filter, MAX_EXPORT_ROWS + 1, tx));
  const truncated = rows.length > MAX_EXPORT_ROWS;
  const bounded = truncated ? rows.slice(0, MAX_EXPORT_ROWS) : rows;
  const csv = toCsv(bounded);

  await audit
    .recordSuccess({
      action: "audit.export.created",
      organizationId: auditOrganizationId,
      resourceType: "audit_export",
      metadata: { rowCount: bounded.length, truncated, filters: toRepositoryFilter(repositoryFilterInput) as Record<string, unknown> },
    })
    .catch((error) => {
      // Non-critical (see audit-system.md's failure-semantics table) —
      // the export itself already succeeded; losing the meta-audit record
      // for the export action must not turn a successful export into a
      // user-facing error.
      console.error("[audit] failed to record audit.export.created", error);
    });

  return { csv, rowCount: bounded.length, truncated };
}

const exportSchema = z.object({ organizationId: z.string().uuid() }).merge(filterSchema);

/** CSV export — same query path, same filters as the list view (no separate, less-audited code path). Hard-capped, and the export itself is audited (`audit.export.created`). */
export async function exportOrganizationAuditEvents(rawInput: unknown): Promise<AuditExportResult> {
  const input = parseOrThrow(exportSchema, rawInput);
  const context = await requirePermission("audit.export", input.organizationId);

  return runExport(context, { organizationId: input.organizationId, ...toRepositoryFilter(input) }, input.organizationId, input);
}

const platformExportSchema = z.object({}).merge(filterSchema);

/** Platform-wide CSV export — same `organizationId IS NULL` + platform-org scoping as `listPlatformAuditEvents()`, never an arbitrary customer organization. `audit.exportPlatform`. */
export async function exportPlatformAuditEvents(rawInput: unknown): Promise<AuditExportResult> {
  const input = parseOrThrow(platformExportSchema, rawInput);
  const context = await requirePermission("audit.exportPlatform");

  const platformOrg = await organizationRepository.findPlatformOrganization();
  const organizationIdIn = [null, platformOrg?.id ?? null].filter((v, i, arr) => arr.indexOf(v) === i);

  return runExport(context, { organizationIdIn, ...toRepositoryFilter(input) }, platformOrg?.id ?? null, input);
}

function toCsv(rows: AuditEvent[]): string {
  const headers = ["id", "createdAt", "action", "category", "outcome", "actorDisplayName", "actorUserId", "resourceType", "resourceId", "resourceName", "requestId", "correlationId"];
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const str = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape((row as unknown as Record<string, unknown>)[h])).join(","));
  }
  return lines.join("\n");
}

// `describeAuditEvent()` lives in `./describe.ts` — pure presentation
// logic, no reason for it to carry this module's `"server-only"`
// boundary. Import it from there directly.
