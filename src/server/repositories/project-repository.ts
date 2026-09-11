import "server-only";
import type { Project, ProjectStatus, ProjectPriority } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

export interface ProjectCreateInput {
  id: string;
  organizationId: string;
  customerOrganizationId: string;
  companyId: string;
  originatingOnboardingId: string | null;
  sourceServiceItemId: string | null;
  /** Build 29 (Service Management) — the canonical `CustomerService` this project delivers, if any. Additive, optional, independent of `sourceServiceItemId` (the historical onboarding provenance) — see service-management.md "Project Management integration." */
  customerServiceId?: string | null;
  sourceTemplateId: string | null;
  title: string;
  description: string | null;
  priority: ProjectPriority;
  ownerUserId: string | null;
  startDate: Date | null;
  targetEndDate: Date | null;
  createdByUserId: string;
  /** Defaults to the schema's own `DRAFT`. `createProjectFromOnboarding()`/`createProjectFromTemplate()` may pass `PLANNED` directly instead of creating DRAFT then immediately transitioning — same "avoid a wasted extra CAS round trip on a row nothing else can see yet" reasoning `crmClientOnboardingRepository.create()` documents. */
  status?: ProjectStatus;
}

export interface ProjectListFilters {
  status?: ProjectStatus;
  customerOrganizationId?: string;
  companyId?: string;
  ownerUserId?: string;
}

/**
 * Data access for `Project` (Build 27 — Roadmap Module 21). Platform-
 * owned (`organizationId` is always the resolved platform organization —
 * see `project-shared.ts`); `customerOrganizationId` is the real customer
 * Organization FK. No DELETE grant exists on this table (matching every
 * prior Build's own discipline) — every mutation below is an
 * update-in-place or a CAS-guarded lifecycle transition.
 */
export const projectRepository = {
  async create(input: ProjectCreateInput, tx: TransactionClient | typeof db = db): Promise<Project> {
    return withDbErrorTranslation(() => tx.project.create({ data: { ...input, status: input.status ?? "DRAFT" } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Project | null> {
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id } }));
  },

  /** Row-locked read — mirrors `crmClientOnboardingRepository.findByIdLocked()`'s own shape. MUST be called inside a transaction. Every lifecycle transition, completion evaluation, and dependency-graph mutation locks this row first so concurrent mutations against the same project always serialize rather than interleave (see project-management.md "Concurrency"). */
  async findByIdLocked(id: string, tx: TransactionClient): Promise<Project | null> {
    const locked = await withDbErrorTranslation(() => tx.$queryRaw<{ id: string }[]>`SELECT id FROM projects WHERE id = ${id}::uuid FOR UPDATE`);
    if (!locked[0]) return null;
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id: locked[0]!.id } }));
  },

  async listForOrganization(organizationId: string, filters: ProjectListFilters = {}, tx: TransactionClient | typeof db = db): Promise<Project[]> {
    return withDbErrorTranslation(() =>
      tx.project.findMany({
        where: {
          organizationId,
          ...(filters.status ? { status: filters.status } : {}),
          ...(filters.customerOrganizationId ? { customerOrganizationId: filters.customerOrganizationId } : {}),
          ...(filters.companyId ? { companyId: filters.companyId } : {}),
          ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
    );
  },

  /** Build 29 (Service Management) — every project delivering ONE `CustomerService`, bounded to 20 (a single service's own project count is small by construction — see service-management.md "Project Management integration" for the cardinality reasoning). Ordered oldest-first (delivery history order), used by the customer-service detail page and the Portal service projection. */
  async listForCustomerService(customerServiceId: string, tx: TransactionClient | typeof db = db): Promise<Project[]> {
    return withDbErrorTranslation(() => tx.project.findMany({ where: { customerServiceId }, orderBy: { createdAt: "asc" }, take: 20 }));
  },

  /**
   * Build 29 — the SAME read as `listForCustomerService()`, batched
   * across MULTIPLE `CustomerService` ids in one query (Codex
   * Performance Engineer finding — `listServicesForCustomer360()` and
   * the Portal's own canonical-services projection were each issuing
   * one query per service, a real N+1 at their own documented 50-row
   * ceiling). Callers group the flat result by `customerServiceId`
   * themselves — grouping in JS over an already-bounded (≤50 services ×
   * ≤20 projects = ≤1000 rows) result set is simpler than a SQL window
   * function for this module's own realistic scale.
   */
  async listForCustomerServices(customerServiceIds: string[], tx: TransactionClient | typeof db = db): Promise<Project[]> {
    if (customerServiceIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.project.findMany({ where: { customerServiceId: { in: customerServiceIds } }, orderBy: { createdAt: "asc" } }));
  },

  /** Bounded to 100 — a single customer organization's own project count, an entirely different (and much smaller) scale than the platform-wide list above; used by both the Customer 360 composition service and the Portal projection service. */
  async listForCustomerOrganization(customerOrganizationId: string, tx: TransactionClient | typeof db = db): Promise<Project[]> {
    return withDbErrorTranslation(() => tx.project.findMany({ where: { customerOrganizationId }, orderBy: { createdAt: "desc" }, take: 100 }));
  },

  async listForOnboarding(originatingOnboardingId: string, tx: TransactionClient | typeof db = db): Promise<Project[]> {
    return withDbErrorTranslation(() => tx.project.findMany({ where: { originatingOnboardingId }, orderBy: { createdAt: "asc" } }));
  },

  /**
   * Idempotency pre-checks mirroring the DB's own two partial unique
   * indexes exactly (`projects_one_active_per_service_item` /
   * `projects_one_active_whole_onboarding`) — `createProjectFromOnboarding()`
   * uses these for a clean `ConflictError` naming the existing project,
   * with the DB constraint itself as the structural backstop for a
   * genuine race (see project-management.md "Idempotency").
   * `findActiveForServiceItem()` also requires `originatingOnboardingId`
   * to match (Codex Security Engineer finding M1) — without it, a
   * caller supplying a real service item id belonging to a DIFFERENT
   * onboarding than the one actually locked/validated could have this
   * idempotent-return branch hand back an unrelated customer's existing
   * project.
   */
  async findActiveForServiceItem(originatingOnboardingId: string, sourceServiceItemId: string, tx: TransactionClient | typeof db = db): Promise<Project | null> {
    return withDbErrorTranslation(() => tx.project.findFirst({ where: { originatingOnboardingId, sourceServiceItemId, status: { not: "CANCELLED" } } }));
  },

  async findActiveForWholeOnboarding(originatingOnboardingId: string, tx: TransactionClient | typeof db = db): Promise<Project | null> {
    return withDbErrorTranslation(() => tx.project.findFirst({ where: { originatingOnboardingId, sourceServiceItemId: null, status: { not: "CANCELLED" } } }));
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; priority: ProjectPriority; ownerUserId: string | null; startDate: Date | null; targetEndDate: Date | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<Project> {
    return withDbErrorTranslation(() => tx.project.update({ where: { id }, data }));
  },

  /** CAS-guarded ordinary (non-terminal) lifecycle transition. `expectedStatuses` is the caller's own `canTransitionProject()`-derived allowed-from set; a lost race (the row moved to some other status between the service's read and this write) returns `null`. */
  async transitionStatus(id: string, expectedStatuses: ProjectStatus[], status: ProjectStatus, tx: TransactionClient | typeof db = db): Promise<Project | null> {
    const result = await withDbErrorTranslation(() => tx.project.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id } }));
  },

  async complete(
    id: string,
    expectedStatuses: ProjectStatus[],
    data: { completedAt: Date; completedByUserId: string; completionOverride: boolean; completionOverrideReason: string | null },
    tx: TransactionClient | typeof db = db,
  ): Promise<Project | null> {
    const result = await withDbErrorTranslation(() => tx.project.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status: "COMPLETED", ...data } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id } }));
  },

  /** Reopen COMPLETED -> ACTIVE — clears every completion field so a later re-completion computes fresh, never carries a stale `completedAt`/override reason forward. */
  async reopen(id: string, tx: TransactionClient | typeof db = db): Promise<Project | null> {
    const result = await withDbErrorTranslation(() =>
      tx.project.updateMany({ where: { id, status: "COMPLETED" }, data: { status: "ACTIVE", completedAt: null, completedByUserId: null, completionOverride: false, completionOverrideReason: null } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id } }));
  },

  async cancel(id: string, expectedStatuses: ProjectStatus[], data: { cancelledAt: Date; cancelledByUserId: string; cancelledReason: string }, tx: TransactionClient | typeof db = db): Promise<Project | null> {
    const result = await withDbErrorTranslation(() => tx.project.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status: "CANCELLED", ...data } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id } }));
  },

  async archive(id: string, expectedStatuses: ProjectStatus[], tx: TransactionClient | typeof db = db): Promise<Project | null> {
    const result = await withDbErrorTranslation(() => tx.project.updateMany({ where: { id, status: { in: expectedStatuses } }, data: { status: "ARCHIVED", archivedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.project.findUnique({ where: { id } }));
  },
};
