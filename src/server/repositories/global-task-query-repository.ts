import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { denormalizeStatusesForSource } from "@/lib/tasks/status-denormalize";
import type { NormalizedTaskStatus, TaskSourceType } from "@/lib/tasks/types";
import type { DueWindow } from "@/lib/tasks/due-window";

/**
 * The Build 28 (Task Management) global cross-source read model —
 * FROZEN architecture decision "Global pagination strategy": a single
 * raw SQL `UNION ALL` across every AUTHORIZED source table, with a REAL
 * `ORDER BY` + `LIMIT`/`OFFSET` applied to the unioned result, executed
 * inside the SAME platform-context tenant transaction every other
 * platform-owned read in this codebase uses (RLS applies per underlying
 * table exactly as it does for any other query on that connection, raw
 * SQL or not).
 *
 * This is deliberately NOT "fetch top-N from each source, merge in
 * memory" — that shape LOOKS paginated but silently drops real rows
 * once any one source's own top-N page fills up before the true
 * globally-earliest-due rows from a DIFFERENT source are ever
 * considered. A single UNION ALL with one ORDER BY/LIMIT/OFFSET over
 * the combined set is mathematically correct pagination regardless of
 * how rows are distributed across sources.
 *
 * Each branch is a TWO-LEVEL query: an inner `SELECT` that aliases each
 * source's own real (and differently-named — e.g. `due_date` vs
 * `due_at`, `assigned_to_user_id` vs `responsible_user_id`) columns
 * onto ONE shared column set, filtered by `organization_id` PLUS (per
 * Codex Performance Engineer review — see `statusAndDueWindowPredicate()`)
 * each branch's own natively-typed status/due-window predicate; then an
 * outer `SELECT ... WHERE` that applies the remaining shared filters
 * (assignee/priority/search) against the SHARED alias names uniformly.
 * A filter against a source's own real, differently-named column (e.g.
 * `assigned_to_user_id = ...` vs a source whose real assignee column is
 * `responsible_user_id`) can NOT be pushed into the inner SELECT's own
 * WHERE using a SHARED alias-based clause — standard SQL evaluates a
 * WHERE clause against the FROM table's real columns, before its own
 * SELECT list's aliases exist. Status/due-window predicates are written
 * per-branch instead specifically because they need each branch's own
 * REAL, natively-typed column (a native Postgres enum comparison, a bare
 * un-wrapped due-date column) to stay index-sargable; assignee/priority/
 * search stay on the outer shared alias, confirmed by EXPLAIN to still
 * reach each source's own index through it.
 *
 * **Authorization is the caller's job, not this file's.** `sourceTypes`
 * must already be the caller's own authorization-filtered list (only
 * the sources the current user is independently entitled to read) —
 * this repository has no opinion on permissions and will happily
 * include whatever `sourceTypes` it's given. See
 * `src/server/services/tasks/` for where that filtering actually
 * happens, and docs/architecture/task-management.md "Authorization
 * intersection" for why this split is the load-bearing security
 * property of this whole module.
 *
 * Display context (project title, company name, assignee name) is
 * resolved in a SEPARATE, bounded batch keyed off the distinct ids on
 * the returned PAGE ONLY (see
 * `src/server/services/tasks/global-task-service.ts`), never per-row —
 * this file only ever returns scalar columns and raw FK ids.
 */

export interface GlobalTaskRow {
  sourceType: TaskSourceType;
  sourceId: string;
  title: string;
  description: string | null;
  statusRaw: string;
  dueAt: Date | null;
  assignedToUserId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  priority: string | null;
  contextProjectId: string | null;
  contextOnboardingId: string | null;
  contextCompanyId: string | null;
}

export interface GlobalTaskQueryFilters {
  sourceTypes: TaskSourceType[];
  assignedToUserId?: string;
  status?: NormalizedTaskStatus[];
  priority?: string[];
  dueWindow?: DueWindow;
  search?: string;
}

interface RawRow {
  source_type: string;
  source_id: string;
  title: string;
  description: string | null;
  status_raw: string;
  due_at: Date | null;
  assigned_to_user_id: string | null;
  created_at: Date;
  completed_at: Date | null;
  priority: string | null;
  context_project_id: string | null;
  context_onboarding_id: string | null;
  context_company_id: string | null;
}

// A `timestamptz` constant for "start of today, UTC" — computed once per
// statement by Postgres itself (`NOW()` is stable within one statement),
// then compared directly against each branch's own BARE real due column
// (never wrapped in `AT TIME ZONE`/`::date` on the column side). Codex
// Performance Engineer finding (P1): the previous `(due_at AT TIME ZONE
// 'UTC')::date` shape applied a function to the indexed column itself,
// which made the predicate non-sargable (no btree index can serve a
// range condition through a function wrapper) — confirmed by EXPLAIN
// against the live dev database. `classifyDueWindow()`/`isOverdue()` in
// `src/lib/tasks/due-window.ts` still express the exact same UTC-
// calendar-day boundary; this is the same semantics, restated so an
// index can actually serve it.
const START_OF_TODAY_UTC = Prisma.sql`(date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

/**
 * Per-branch status/due-window predicates, applied INSIDE each branch's
 * own inner `SELECT ... WHERE` — against that branch's own REAL column
 * (`status`, plus `due_date`/`due_at`/`responsible_user_id` as
 * appropriate), never the outer shared alias. Two Codex Performance
 * Engineer P1 findings drove this split from the outer `sharedWhereClause`
 * below:
 *   - Comparing the outer `status_raw` TEXT alias against a text array
 *     (the previous shape) prevented Postgres from using a source's own
 *     NATIVE ENUM index condition — confirmed by EXPLAIN. Each source's
 *     status column is a genuinely different Postgres enum type, so this
 *     predicate must be typed per branch; it cannot be one shared
 *     function using one alias.
 *   - When no status filter is requested at all, the previous version
 *     still emitted `status_raw = ANY(<every possible raw value>)` — a
 *     redundant predicate on every branch, every request. Omitted
 *     entirely now when `filters.status` is unset.
 *
 * `enumType`/`dueColumn` are NOT derived from `filters` or any client
 * input — each is a single hardcoded literal string owned by the ONE
 * branch function that calls this, from the fixed 5-branch set below.
 * `Prisma.raw()` is used here (and only here, plus the identical
 * `terminalRaw` case) because Postgres has no bind-parameter syntax for
 * a type name in a `::type[]` cast — this is a hard SQL syntax
 * constraint, not a relaxation of the "zero `Prisma.raw()` for
 * client-influenced values" rule the rest of this file follows (see the
 * top-level doc comment); every value that co-exists with these raw
 * identifiers (`rawStatuses`, the source-type literal) is still a plain
 * bound parameter or a fixed compile-time string.
 */
function statusAndDueWindowPredicate(sourceType: TaskSourceType, filters: GlobalTaskQueryFilters, enumType: string, dueColumn: string): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  const dueColumnRaw = Prisma.raw(dueColumn);

  if (filters.status && filters.status.length > 0) {
    const rawStatuses = denormalizeStatusesForSource(sourceType, filters.status);
    // An empty list means this source has NO raw status matching the
    // requested normalized filter (e.g. CANCELLED against an onboarding
    // source) — `status = ANY('{}'::enum[])` is always false, correctly
    // excluding every row from this branch without a special case.
    clauses.push(Prisma.sql`status = ANY(${rawStatuses}::${Prisma.raw(enumType)}[])`);
  }

  if (filters.dueWindow) {
    switch (filters.dueWindow) {
      case "OVERDUE":
        clauses.push(Prisma.sql`${dueColumnRaw} IS NOT NULL AND ${dueColumnRaw} < ${START_OF_TODAY_UTC}`);
        break;
      case "DUE_TODAY":
        clauses.push(Prisma.sql`${dueColumnRaw} IS NOT NULL AND ${dueColumnRaw} >= ${START_OF_TODAY_UTC} AND ${dueColumnRaw} < ${START_OF_TODAY_UTC} + INTERVAL '1 day'`);
        break;
      case "UPCOMING":
        clauses.push(Prisma.sql`${dueColumnRaw} IS NOT NULL AND ${dueColumnRaw} >= ${START_OF_TODAY_UTC} + INTERVAL '1 day'`);
        break;
      case "NO_DUE_DATE":
        clauses.push(Prisma.sql`${dueColumnRaw} IS NULL`);
        break;
    }
    // A due-window filter implicitly excludes terminal work — matches
    // `classifyDueWindow()`'s own "null for COMPLETED/CANCELLED" rule.
    const terminalRaw = denormalizeStatusesForSource(sourceType, ["COMPLETED", "CANCELLED"]);
    if (terminalRaw.length > 0) clauses.push(Prisma.sql`status <> ALL(${terminalRaw}::${Prisma.raw(enumType)}[])`);
  }

  if (clauses.length === 0) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.join(clauses, " AND ")}`;
}

/** Applied in the OUTER wrapper around every branch, against the shared alias names (`assigned_to_user_id`, `title`, `priority`) every inner SELECT below produces — confirmed by Codex Performance Engineer review to still reach each source's own assignee index through this alias (Postgres flattens the two-level view). Status/due-window are handled per-branch instead — see `statusAndDueWindowPredicate()` above. */
function sharedWhereClause(filters: GlobalTaskQueryFilters, hasPriorityColumn: boolean): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];

  if (filters.assignedToUserId) clauses.push(Prisma.sql`assigned_to_user_id = ${filters.assignedToUserId}::uuid`);

  if (filters.priority && filters.priority.length > 0) {
    // A source with no real priority column always projects `priority`
    // as a literal NULL — `NULL = ANY(...)` evaluates to NULL (falsy),
    // so a priority filter correctly excludes every row from a
    // priority-less source. Still made explicit via `hasPriorityColumn`
    // for readability, not relied on implicitly.
    clauses.push(hasPriorityColumn ? Prisma.sql`priority = ANY(${filters.priority})` : Prisma.sql`FALSE`);
  }

  if (filters.search) clauses.push(Prisma.sql`title ILIKE ${`%${filters.search}%`}`);

  if (clauses.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(clauses, " AND ")}`;
}

function projectTaskBranch(organizationId: string, filters: GlobalTaskQueryFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'PROJECT_TASK'::text AS source_type, id::text AS source_id, title, description, status::text AS status_raw, due_date AS due_at,
             assigned_to_user_id, created_at, completed_at, priority::text AS priority,
             project_id AS context_project_id, NULL::uuid AS context_onboarding_id, NULL::uuid AS context_company_id
      FROM project_tasks
      WHERE organization_id = ${organizationId}::uuid
      ${statusAndDueWindowPredicate("PROJECT_TASK", filters, "project_task_status", "due_date")}
    ) AS branch_rows
    ${sharedWhereClause(filters, true)}
  `;
}

function crmTaskBranch(organizationId: string, filters: GlobalTaskQueryFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'CRM_TASK'::text AS source_type, id::text AS source_id, title, description, status::text AS status_raw, due_at,
             assigned_to_user_id, created_at, completed_at, NULL::text AS priority,
             NULL::uuid AS context_project_id, NULL::uuid AS context_onboarding_id, company_id AS context_company_id
      FROM crm_tasks
      WHERE organization_id = ${organizationId}::uuid
      ${statusAndDueWindowPredicate("CRM_TASK", filters, "crm_task_status", "due_at")}
    ) AS branch_rows
    ${sharedWhereClause(filters, false)}
  `;
}

function onboardingChecklistBranch(organizationId: string, filters: GlobalTaskQueryFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'ONBOARDING_CHECKLIST'::text AS source_type, id::text AS source_id, title, description, status::text AS status_raw, due_date AS due_at,
             assigned_to_user_id, created_at, completed_at, NULL::text AS priority,
             NULL::uuid AS context_project_id, onboarding_id AS context_onboarding_id, NULL::uuid AS context_company_id
      FROM crm_client_onboarding_checklist_items
      WHERE organization_id = ${organizationId}::uuid
      ${statusAndDueWindowPredicate("ONBOARDING_CHECKLIST", filters, "crm_client_onboarding_checklist_item_status", "due_date")}
    ) AS branch_rows
    ${sharedWhereClause(filters, false)}
  `;
}

function onboardingRequirementBranch(organizationId: string, filters: GlobalTaskQueryFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'ONBOARDING_REQUIREMENT'::text AS source_type, id::text AS source_id, title, description, status::text AS status_raw, due_date AS due_at,
             responsible_user_id AS assigned_to_user_id, created_at, completed_at, NULL::text AS priority,
             NULL::uuid AS context_project_id, onboarding_id AS context_onboarding_id, NULL::uuid AS context_company_id
      FROM crm_client_onboarding_requirements
      WHERE organization_id = ${organizationId}::uuid
      ${statusAndDueWindowPredicate("ONBOARDING_REQUIREMENT", filters, "crm_client_onboarding_requirement_status", "due_date")}
    ) AS branch_rows
    ${sharedWhereClause(filters, false)}
  `;
}

function standaloneTaskBranch(organizationId: string, filters: GlobalTaskQueryFilters): Prisma.Sql {
  return Prisma.sql`
    SELECT * FROM (
      SELECT 'STANDALONE_TASK'::text AS source_type, id::text AS source_id, title, description, status::text AS status_raw, due_at,
             assigned_to_user_id, created_at, completed_at, priority::text AS priority,
             NULL::uuid AS context_project_id, NULL::uuid AS context_onboarding_id, NULL::uuid AS context_company_id
      FROM internal_tasks
      WHERE organization_id = ${organizationId}::uuid
      ${statusAndDueWindowPredicate("STANDALONE_TASK", filters, "internal_task_status", "due_at")}
    ) AS branch_rows
    ${sharedWhereClause(filters, true)}
  `;
}

const BRANCH_BUILDERS: Record<TaskSourceType, (organizationId: string, filters: GlobalTaskQueryFilters) => Prisma.Sql> = {
  PROJECT_TASK: projectTaskBranch,
  CRM_TASK: crmTaskBranch,
  ONBOARDING_CHECKLIST: onboardingChecklistBranch,
  ONBOARDING_REQUIREMENT: onboardingRequirementBranch,
  STANDALONE_TASK: standaloneTaskBranch,
};

function buildUnion(organizationId: string, filters: GlobalTaskQueryFilters): Prisma.Sql {
  const branches = filters.sourceTypes.map((sourceType) => BRANCH_BUILDERS[sourceType](organizationId, filters));
  return Prisma.join(branches, " UNION ALL ");
}

export const globalTaskQueryRepository = {
  /** `limit`/`offset` are real SQL `LIMIT`/`OFFSET` over the FULL unioned+ordered result — true global pagination, not a per-source top-N merge. */
  async listPage(organizationId: string, filters: GlobalTaskQueryFilters, limit: number, offset: number, tx: TransactionClient | typeof db = db): Promise<GlobalTaskRow[]> {
    if (filters.sourceTypes.length === 0) return [];
    const union = buildUnion(organizationId, filters);
    const rows = await withDbErrorTranslation(() =>
      tx.$queryRaw<RawRow[]>(Prisma.sql`
        SELECT * FROM (${union}) AS unioned
        ORDER BY due_at ASC NULLS LAST, created_at ASC, source_type ASC, source_id ASC
        LIMIT ${limit} OFFSET ${offset}
      `),
    );
    return rows.map(mapRow);
  },

  /** The matching `COUNT(*)` for the SAME filter set — required for real "page N of M" pagination, not an estimate. */
  async countAll(organizationId: string, filters: GlobalTaskQueryFilters, tx: TransactionClient | typeof db = db): Promise<number> {
    if (filters.sourceTypes.length === 0) return 0;
    const union = buildUnion(organizationId, filters);
    const rows = await withDbErrorTranslation(() => tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS count FROM (${union}) AS unioned`));
    return Number(rows[0]?.count ?? 0);
  },
};

function mapRow(row: RawRow): GlobalTaskRow {
  return {
    sourceType: row.source_type as TaskSourceType,
    sourceId: row.source_id,
    title: row.title,
    description: row.description,
    statusRaw: row.status_raw,
    dueAt: row.due_at,
    assignedToUserId: row.assigned_to_user_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    priority: row.priority,
    contextProjectId: row.context_project_id,
    contextOnboardingId: row.context_onboarding_id,
    contextCompanyId: row.context_company_id,
  };
}
