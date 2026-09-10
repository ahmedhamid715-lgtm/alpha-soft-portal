import "server-only";
import type { ProjectApproval, ProjectApprovalResourceType, ProjectVisibility } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `ProjectApproval` — a narrow, PROJECT/MILESTONE-scoped
 * approval record (never a reusable global approval workflow engine; see
 * project-management.md "Approvals vs. Roadmap Module 67"). Self-approval
 * is rejected at both the DB CHECK level and the service layer. No
 * DELETE grant; `decide()` is the only mutation after `request()`.
 */
export const projectApprovalRepository = {
  async create(
    input: { id: string; organizationId: string; projectId: string; resourceType: ProjectApprovalResourceType; resourceId: string; requestedByUserId: string; visibility: ProjectVisibility },
    tx: TransactionClient | typeof db = db,
  ): Promise<ProjectApproval> {
    return withDbErrorTranslation(() => tx.projectApproval.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectApproval | null> {
    return withDbErrorTranslation(() => tx.projectApproval.findUnique({ where: { id } }));
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<ProjectApproval[]> {
    return withDbErrorTranslation(() => tx.projectApproval.findMany({ where: { projectId }, orderBy: { requestedAt: "desc" }, take: 200 }));
  },

  async listForProjects(projectIds: string[], tx: TransactionClient | typeof db = db): Promise<ProjectApproval[]> {
    if (projectIds.length === 0) return [];
    return withDbErrorTranslation(() => tx.projectApproval.findMany({ where: { projectId: { in: projectIds } }, orderBy: { requestedAt: "desc" } }));
  },

  async listForResource(resourceType: ProjectApprovalResourceType, resourceId: string, tx: TransactionClient | typeof db = db): Promise<ProjectApproval[]> {
    return withDbErrorTranslation(() => tx.projectApproval.findMany({ where: { resourceType, resourceId }, orderBy: { requestedAt: "desc" } }));
  },

  /** CAS-guarded on `status = PENDING` — a lost race (already decided, e.g. by a concurrent double-submit) returns `null`. */
  async decide(id: string, data: { status: "APPROVED" | "REJECTED"; approverUserId: string; decidedAt: Date; reason: string | null }, tx: TransactionClient | typeof db = db): Promise<ProjectApproval | null> {
    const result = await withDbErrorTranslation(() => tx.projectApproval.updateMany({ where: { id, status: "PENDING" }, data }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectApproval.findUnique({ where: { id } }));
  },
};
