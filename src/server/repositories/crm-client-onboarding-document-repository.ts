import "server-only";
import type { CrmClientOnboardingDocument, CrmClientOnboardingDocumentStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `CrmClientOnboardingDocument` — a metadata-only
 * reference, never a real upload (`storage.ts`/Roadmap Module 56 remains
 * unconfigured — see the model's own schema comment). `fileKey` is
 * accepted here for forward compatibility but Build 23's own service
 * layer never sets it to a non-null value.
 */
export const crmClientOnboardingDocumentRepository = {
  async create(input: { id: string; organizationId: string; onboardingId: string; title: string; description: string | null }, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingDocument> {
    return withDbErrorTranslation(() =>
      tx.crmClientOnboardingDocument.create({
        data: { id: input.id, organizationId: input.organizationId, onboardingId: input.onboardingId, title: input.title, description: input.description },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingDocument | null> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingDocument.findUnique({ where: { id } }));
  },

  async listForOnboarding(onboardingId: string, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingDocument[]> {
    return withDbErrorTranslation(() => tx.crmClientOnboardingDocument.findMany({ where: { onboardingId }, orderBy: { createdAt: "asc" } }));
  },

  /** CAS-guarded on `status = 'REQUESTED'` — records that a document was actually received, with an honest free-text note on how (never a fabricated upload). */
  async markReceived(id: string, receivedNote: string | null, tx: TransactionClient | typeof db = db): Promise<CrmClientOnboardingDocument | null> {
    const result = await withDbErrorTranslation(() => tx.crmClientOnboardingDocument.updateMany({ where: { id, status: "REQUESTED" }, data: { status: "RECEIVED", receivedNote, receivedAt: new Date() } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmClientOnboardingDocument.findUnique({ where: { id } }));
  },
};

export type { CrmClientOnboardingDocumentStatus };
