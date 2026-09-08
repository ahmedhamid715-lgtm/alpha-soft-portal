import "server-only";
import type { CrmProposalVersion, CrmProposalStatus, CrmProposalDiscountType, CrmProposalAcceptanceMechanism, User, CrmContact } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import type { CrmProposalLineItemWithoutIds } from "./crm-proposal-line-item-repository";

export type CrmProposalVersionWithRelations = CrmProposalVersion & {
  createdByUser: Pick<User, "id" | "name">;
  sentByUser: Pick<User, "id" | "name"> | null;
  approvalSubmittedByUser: Pick<User, "id" | "name"> | null;
  approvalDecidedByUser: Pick<User, "id" | "name"> | null;
  acceptedByStaffUser: Pick<User, "id" | "name"> | null;
  acceptedByContact: Pick<CrmContact, "id" | "firstName" | "lastName"> | null;
};

const RELATIONS_INCLUDE = {
  createdByUser: { select: { id: true, name: true } },
  sentByUser: { select: { id: true, name: true } },
  approvalSubmittedByUser: { select: { id: true, name: true } },
  approvalDecidedByUser: { select: { id: true, name: true } },
  acceptedByStaffUser: { select: { id: true, name: true } },
  acceptedByContact: { select: { id: true, firstName: true, lastName: true } },
} as const;

/**
 * Data access for `CrmProposalVersion` — RLS-protected, with the real
 * immutability guarantee enforced by a database trigger (see the
 * migration's own comment): once a version leaves DRAFT, its COMMERCIAL
 * fields (title/body/pricing/lineItems) can never change again, but its
 * LIFECYCLE fields (status, sent/accepted/rejected/approval) keep
 * transitioning through their own real state machine. This repository's
 * own method shapes mirror that split deliberately — `updateDraftContent()`
 * only ever runs against a DRAFT row (the caller's own service-layer
 * guard, backed by the DB trigger as the real guarantee); every other
 * method here only ever touches lifecycle fields.
 */
export const crmProposalVersionRepository = {
  async create(
    input: {
      id: string;
      organizationId: string;
      proposalId: string;
      versionNumber: number;
      title: string;
      bodyHtml: string;
      termsHtml: string | null;
      currency: string;
      subtotalMinorUnits: number;
      discountType: CrmProposalDiscountType;
      discountValue: number | null;
      discountedSubtotalMinorUnits: number;
      taxAmountMinorUnits: number | null;
      totalMinorUnits: number;
      validUntil: Date;
      createdByUserId: string;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposalVersion> {
    return withDbErrorTranslation(() =>
      tx.crmProposalVersion.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          proposalId: input.proposalId,
          versionNumber: input.versionNumber,
          title: input.title,
          bodyHtml: input.bodyHtml,
          termsHtml: input.termsHtml,
          currency: input.currency,
          subtotalMinorUnits: input.subtotalMinorUnits,
          discountType: input.discountType,
          discountValue: input.discountValue,
          discountedSubtotalMinorUnits: input.discountedSubtotalMinorUnits,
          taxAmountMinorUnits: input.taxAmountMinorUnits,
          totalMinorUnits: input.totalMinorUnits,
          validUntil: input.validUntil,
          createdByUserId: input.createdByUserId,
        },
      }),
    );
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersion | null> {
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },

  async findByIdWithRelations(id: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersionWithRelations | null> {
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id }, include: RELATIONS_INCLUDE }));
  },

  async listForProposal(proposalId: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersionWithRelations[]> {
    return withDbErrorTranslation(() => tx.crmProposalVersion.findMany({ where: { proposalId }, include: RELATIONS_INCLUDE, orderBy: { versionNumber: "desc" } }));
  },

  /** ONLY valid while the row is still DRAFT — the database trigger is the real guarantee; this method's own name is the app-layer reminder. */
  async updateDraftContent(
    id: string,
    data: Partial<{
      title: string;
      bodyHtml: string;
      termsHtml: string | null;
      currency: string;
      subtotalMinorUnits: number;
      discountType: CrmProposalDiscountType;
      discountValue: number | null;
      discountedSubtotalMinorUnits: number;
      taxAmountMinorUnits: number | null;
      totalMinorUnits: number;
      validUntil: Date;
    }>,
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposalVersion> {
    return withDbErrorTranslation(() => tx.crmProposalVersion.update({ where: { id }, data }));
  },

  /** DRAFT -> SENT. CAS-guarded — a lost race (already sent by a concurrent request) returns `null`. */
  async markSent(id: string, sentByUserId: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersion | null> {
    const result = await withDbErrorTranslation(() => tx.crmProposalVersion.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENT", sentAt: new Date(), sentByUserId } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },

  async submitForApproval(id: string, submittedByUserId: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersion | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmProposalVersion.updateMany({ where: { id, approvalStatus: "NOT_REQUIRED" }, data: { approvalStatus: "PENDING", approvalSubmittedByUserId: submittedByUserId, approvalSubmittedAt: new Date() } }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },

  async decideApproval(id: string, approved: boolean, decidedByUserId: string, note: string | null, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersion | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmProposalVersion.updateMany({
        where: { id, approvalStatus: "PENDING" },
        data: { approvalStatus: approved ? "APPROVED" : "REJECTED", approvalDecidedByUserId: decidedByUserId, approvalDecidedAt: new Date(), approvalNote: note },
      }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },

  /** SENT -> ACCEPTED. CAS-guarded on `status = 'SENT'` — structurally rejects double-acceptance and accepting a superseded/expired version (the caller resolves the CURRENT version id itself; there is no way to target an old one — see the service layer). */
  async markAccepted(
    id: string,
    data: { acceptedByContactId: string | null; acceptedSignerName: string; acceptedSignerEmail: string; acceptedByStaffUserId: string; acceptanceMechanism: CrmProposalAcceptanceMechanism },
    tx: TransactionClient | typeof db = db,
  ): Promise<CrmProposalVersion | null> {
    const result = await withDbErrorTranslation(() =>
      tx.crmProposalVersion.updateMany({
        where: { id, status: "SENT" },
        data: { status: "ACCEPTED", acceptedAt: new Date(), ...data },
      }),
    );
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },

  /** SENT -> REJECTED. CAS-guarded on `status = 'SENT'`. */
  async markRejected(id: string, reason: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersion | null> {
    const result = await withDbErrorTranslation(() => tx.crmProposalVersion.updateMany({ where: { id, status: "SENT" }, data: { status: "REJECTED", rejectedAt: new Date(), rejectedReason: reason } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },

  /** SENT -> EXPIRED. CAS-guarded on `status = 'SENT'`. */
  async markExpired(id: string, tx: TransactionClient | typeof db = db): Promise<CrmProposalVersion | null> {
    const result = await withDbErrorTranslation(() => tx.crmProposalVersion.updateMany({ where: { id, status: "SENT" }, data: { status: "EXPIRED" } }));
    if (result.count === 0) return null;
    return withDbErrorTranslation(() => tx.crmProposalVersion.findUnique({ where: { id } }));
  },
};

export type { CrmProposalStatus, CrmProposalLineItemWithoutIds };
