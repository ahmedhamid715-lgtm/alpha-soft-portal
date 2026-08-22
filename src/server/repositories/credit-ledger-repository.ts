import "server-only";
import type { CreditLedgerEntry, CreditLedgerEntryType } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `CreditLedgerEntry` — RLS-protected, append-only (no update/delete method exists here at all — see the model's own doc comment and this table's RLS migration, which has no UPDATE/DELETE policy). */
export const creditLedgerRepository = {
  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CreditLedgerEntry | null> {
    return withDbErrorTranslation(() => tx.creditLedgerEntry.findUnique({ where: { id } }));
  },

  async listForOrganization(organizationId: string, tx: TransactionClient | typeof db = db): Promise<CreditLedgerEntry[]> {
    return withDbErrorTranslation(() => tx.creditLedgerEntry.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" } }));
  },

  async create(
    input: {
      id: string;
      organizationId: string;
      billingAccountId: string;
      type: CreditLedgerEntryType;
      amount: number;
      currency: string;
      reason: string;
      relatedInvoiceId?: string | null;
      relatedPaymentId?: string | null;
      relatedEntryId?: string | null;
      initiatedByUserId?: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CreditLedgerEntry> {
    return withDbErrorTranslation(() =>
      tx.creditLedgerEntry.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          billingAccountId: input.billingAccountId,
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          reason: input.reason,
          relatedInvoiceId: input.relatedInvoiceId ?? null,
          relatedPaymentId: input.relatedPaymentId ?? null,
          relatedEntryId: input.relatedEntryId ?? null,
          initiatedByUserId: input.initiatedByUserId ?? null,
        },
      }),
    );
  },
};
