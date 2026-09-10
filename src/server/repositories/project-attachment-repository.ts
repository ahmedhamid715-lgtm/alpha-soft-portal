import "server-only";
import type { ProjectAttachment, ProjectVisibility } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `ProjectAttachment` — metadata + an optional externally
 * hosted URL only (see the schema's own doc comment; `fileKey` is
 * reserved for a real StorageProvider and always null in this build). No
 * DELETE grant; no update path either — an attachment record is
 * write-once (a mistaken upload is superseded by a new record, not
 * edited in place, so the audit trail of "what was ever attached" stays
 * honest).
 */
export const projectAttachmentRepository = {
  async create(
    input: { id: string; organizationId: string; projectId: string; taskId: string | null; title: string; description: string | null; externalUrl: string | null; visibility: ProjectVisibility; uploadedByUserId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<ProjectAttachment> {
    return withDbErrorTranslation(() => tx.projectAttachment.create({ data: input }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<ProjectAttachment | null> {
    return withDbErrorTranslation(() => tx.projectAttachment.findUnique({ where: { id } }));
  },

  async listForProject(projectId: string, tx: TransactionClient | typeof db = db): Promise<ProjectAttachment[]> {
    return withDbErrorTranslation(() => tx.projectAttachment.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 500 }));
  },

  async listForTask(taskId: string, tx: TransactionClient | typeof db = db): Promise<ProjectAttachment[]> {
    return withDbErrorTranslation(() => tx.projectAttachment.findMany({ where: { taskId }, orderBy: { createdAt: "desc" }, take: 500 }));
  },
};
