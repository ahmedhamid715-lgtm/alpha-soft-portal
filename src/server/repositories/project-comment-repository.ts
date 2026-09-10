import "server-only";
import type { ProjectComment, ProjectVisibility } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `ProjectComment` — plain-text only (see the schema's
 * own doc comment; clients render `body` as a text node, never via
 * `dangerouslySetInnerHTML`, so no HTML sanitizer is needed here). No
 * DELETE grant; `edit()` is the only mutation after creation.
 */
export const projectCommentRepository = {
  async create(input: { id: string; organizationId: string; projectId: string; taskId: string | null; authorUserId: string; body: string; visibility: ProjectVisibility }, tx: TransactionClient | typeof db = db): Promise<ProjectComment> {
    return withDbErrorTranslation(() => tx.projectComment.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectComment | null> {
    return withDbErrorTranslation(() => tx.projectComment.findUnique({ where: { id } }));
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<ProjectComment[]> {
    return withDbErrorTranslation(() => tx.projectComment.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  async listForTask(taskId: string, tx: TransactionClient | typeof db = db): Promise<ProjectComment[]> {
    return withDbErrorTranslation(() => tx.projectComment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" }, take: 500 }));
  },

  /** Author-only edit (enforced by the service, not here) — always stamps `editedAt` so an edited comment is honestly distinguishable from an original one in the UI. */
  async edit(id: string, body: string, tx: TransactionClient | typeof db = db): Promise<ProjectComment> {
    return withDbErrorTranslation(() => tx.projectComment.update({ where: { id }, data: { body, editedAt: new Date() } }));
  },
};
