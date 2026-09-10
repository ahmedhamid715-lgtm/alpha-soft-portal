import "server-only";
import type { ProjectTemplate, ProjectTemplateStatus, ProjectTemplateMilestone, ProjectTemplateTask, ProjectTemplateQaCheck, ProjectPriority } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for the Project Template family (Build 27 — Roadmap
 * Module 21): `ProjectTemplate` + its three child collections
 * (milestones/tasks/QA checks). Templates are edited freely while
 * `ACTIVE`; instantiation SNAPSHOTS this structure onto a new `Project`
 * at creation time (`project-template-service.ts`'s own
 * `instantiateProject()`) — a later template edit never rewrites an
 * already-created project. No DELETE grant on any of these four tables;
 * `archive()`/`reactivate()` are the only lifecycle mutation.
 */
export const projectTemplateRepository = {
  async create(input: { id: string; organizationId: string; name: string; description: string | null; createdByUserId: string }, tx: TransactionClient | typeof db = db): Promise<ProjectTemplate> {
    return withDbErrorTranslation(() => tx.projectTemplate.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplate | null> {
    return withDbErrorTranslation(() => tx.projectTemplate.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, status: ProjectTemplateStatus | undefined, tx: TransactionClient | typeof db = db): Promise<ProjectTemplate[]> {
    return withDbErrorTranslation(() => tx.projectTemplate.findMany({ where: { organizationId, ...(status ? { status } : {}) }, orderBy: { name: "asc" }, take: 200 }));
  },

  async update(id: string, data: Partial<{ name: string; description: string | null }>, tx: TransactionClient | typeof db = db): Promise<ProjectTemplate> {
    return withDbErrorTranslation(() => tx.projectTemplate.update({ where: { id }, data }));
  },

  async archive(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplate | null> {
    const result = await withDbErrorTranslation(() => tx.projectTemplate.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ARCHIVED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectTemplate.findUnique({ where: { id } }));
  },

  async reactivate(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplate | null> {
    const result = await withDbErrorTranslation(() => tx.projectTemplate.updateMany({ where: { id, status: "ARCHIVED" }, data: { status: "ACTIVE" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.projectTemplate.findUnique({ where: { id } }));
  },
};

const TEMPLATE_SORT_GAP = 1000;
export { TEMPLATE_SORT_GAP };

export const projectTemplateMilestoneRepository = {
  async create(
    input: { id: string; organizationId: string; templateId: string; title: string; description: string | null; sortOrder: number; relativeDueDays: number | null; customerVisible: boolean },
    tx: TransactionClient | typeof db = db,
  ): Promise<ProjectTemplateMilestone> {
    return withDbErrorTranslation(() => tx.projectTemplateMilestone.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateMilestone | null> {
    return withDbErrorTranslation(() => tx.projectTemplateMilestone.findUnique({ where: { id } }));
  },

  async listForTemplate(templateId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateMilestone[]> {
    return withDbErrorTranslation(() => tx.projectTemplateMilestone.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" } }));
  },

  async update(id: string, data: Partial<{ title: string; description: string | null; relativeDueDays: number | null; customerVisible: boolean; sortOrder: number }>, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateMilestone> {
    return withDbErrorTranslation(() => tx.projectTemplateMilestone.update({ where: { id }, data }));
  },
};

export const projectTemplateTaskRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      templateId: string;
      templateMilestoneId: string | null;
      title: string;
      description: string | null;
      sortOrder: number;
      relativeDueDays: number | null;
      priority: ProjectPriority;
      customerVisible: boolean;
      defaultAssigneeRoleHint: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<ProjectTemplateTask> {
    return withDbErrorTranslation(() => tx.projectTemplateTask.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateTask | null> {
    return withDbErrorTranslation(() => tx.projectTemplateTask.findUnique({ where: { id } }));
  },

  async listForTemplate(templateId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateTask[]> {
    return withDbErrorTranslation(() => tx.projectTemplateTask.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" } }));
  },

  async update(
    id: string,
    data: Partial<{ title: string; description: string | null; relativeDueDays: number | null; priority: ProjectPriority; customerVisible: boolean; defaultAssigneeRoleHint: string | null; sortOrder: number; templateMilestoneId: string | null }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<ProjectTemplateTask> {
    return withDbErrorTranslation(() => tx.projectTemplateTask.update({ where: { id }, data }));
  },
};

export const projectTemplateQaCheckRepository = {
  async create(input: { id: string; organizationId: string; templateId: string; title: string; required: boolean; sortOrder: number }, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateQaCheck> {
    return withDbErrorTranslation(() => tx.projectTemplateQaCheck.create({ data: input }));
  },

  async listForTemplate(templateId: string, tx: TransactionClient | typeof db = db): Promise<ProjectTemplateQaCheck[]> {
    return withDbErrorTranslation(() => tx.projectTemplateQaCheck.findMany({ where: { templateId }, orderBy: { sortOrder: "asc" } }));
  },
};
