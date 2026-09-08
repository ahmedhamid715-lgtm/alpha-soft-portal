import "server-only";
import type { CrmProposalTemplate, CrmProposalTemplateStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CrmProposalTemplate` — RLS-protected, tenant-owned proposal-starting-content only (not a document CMS — see the model's own schema comment). */
export const crmProposalTemplateRepository = {
  async create(
    input: { id: string; organizationId: string; name: string; defaultTitle: string; defaultBodyHtml: string; defaultTermsHtml: string | null; defaultValidityDays: number },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposalTemplate> {
    return withDbErrorTranslation(() =>
      tx.crmProposalTemplate.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          name: input.name,
          defaultTitle: input.defaultTitle,
          defaultBodyHtml: input.defaultBodyHtml,
          defaultTermsHtml: input.defaultTermsHtml,
          defaultValidityDays: input.defaultValidityDays,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalTemplate | null> {
    return withDbErrorTranslation(() => tx.crmProposalTemplate.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, status: CrmProposalTemplateStatus | undefined, tx: TransactionClient | typeof db = db): Promise<CrmProposalTemplate[]> {
    return withDbErrorTranslation(() =>
      tx.crmProposalTemplate.findMany({ where: { organizationId, ...(status ? { status } : {}) }, orderBy: { name: "asc" } }),
    );
  },

  async update(
    id: string,
    data: Partial<{ name: string; defaultTitle: string; defaultBodyHtml: string; defaultTermsHtml: string | null; defaultValidityDays: number }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposalTemplate> {
    return withDbErrorTranslation(() => tx.crmProposalTemplate.update({ where: { id }, data }));
  },

  /** Archive, never delete — a template referenced by historical proposals (`SetNull` on delete would silently sever provenance; archiving keeps it intact and just hides it from "new proposal" pickers). */
  async setStatus(id: string, status: CrmProposalTemplateStatus, tx: TransactionClient | typeof db = db): Promise<CrmProposalTemplate> {
    return withDbErrorTranslation(() => tx.crmProposalTemplate.update({ where: { id }, data: { status } }));
  },
};
