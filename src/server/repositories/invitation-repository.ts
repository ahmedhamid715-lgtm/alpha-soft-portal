import "server-only";
import type { Invitation, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import {
  toOffsetPaginatedResult,
  type OffsetPaginatedResult,
  type OffsetPaginationParams,
} from "@/lib/platform/pagination";

/**
 * Data access for `Invitation` (spec section 11) — same conventions as
 * every other repository: thin, no business logic, `tx`-composable.
 * `invitation-service.ts` owns token generation/hashing, expiry
 * duration, and the actual accept/revoke rules.
 */
export interface CreateInvitationInput {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  invitedByUserId: string;
  tokenHash: string;
  expiresAt: Date;
}

export const invitationRepository = {
  async create(input: CreateInvitationInput, tx: TransactionClient | typeof db = db): Promise<Invitation> {
    return withDbErrorTranslation(() =>
      tx.invitation.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          email: input.email,
          roleId: input.roleId,
          invitedByUserId: input.invitedByUserId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      }),
    );
  },

  async findByTokenHash(tokenHash: string, tx: TransactionClient | typeof db = db): Promise<Invitation | null> {
    return withDbErrorTranslation(() => tx.invitation.findUnique({ where: { tokenHash } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<Invitation | null> {
    return withDbErrorTranslation(() => tx.invitation.findUnique({ where: { id } }));
  },

  /** The spec section 15 dedup check — relies on the same partial unique index (`organization_invitations_pending_email_key`) as its actual enforcement; this is the friendly pre-check, not the only guard. */
  async findPendingByOrganizationAndEmail(
    organizationId: string,
    email: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<Invitation | null> {
    return withDbErrorTranslation(() =>
      tx.invitation.findFirst({ where: { organizationId, email, status: "PENDING" } }),
    );
  },

  /** This organization's invitation list, newest first — the admin-facing "pending invitations" view. */
  async listForOrganization(
    organizationId: string,
    params: OffsetPaginationParams,
    filter: { status?: Prisma.InvitationWhereInput["status"] } = {},
    tx: TransactionClient | typeof db = db,
  ): Promise<OffsetPaginatedResult<Prisma.InvitationGetPayload<{ include: { role: true; invitedBy: true } }>>> {
    const where: Prisma.InvitationWhereInput = { organizationId, ...(filter.status ? { status: filter.status } : {}) };
    const items = await withDbErrorTranslation(() =>
      tx.invitation.findMany({
        where,
        include: { role: true, invitedBy: true },
        orderBy: { createdAt: "desc" },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
      }),
    );
    return toOffsetPaginatedResult(items, params);
  },

  /**
   * Module 10 — every invitation ever addressed to this email, across
   * every organization, newest first. Read-only cross-org visibility for
   * the global user-detail page (spec section 10: "administrative
   * visibility for pending/accepted/expired/revoked"); actually
   * resending/revoking one still goes through `invitation-service.ts`'s
   * existing `resendInvitation()`/`revokeInvitation()` (each independently
   * re-checks `members.invite` in THAT invitation's own organization —
   * this query grants no authorization by itself, it only lists rows).
   */
  async listByEmail(email: string, tx: TransactionClient | typeof db = db): Promise<Prisma.InvitationGetPayload<{ include: { organization: true; role: true } }>[]> {
    return withDbErrorTranslation(() =>
      tx.invitation.findMany({
        where: { email },
        include: { organization: true, role: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );
  },

  async revoke(id: string, tx: TransactionClient | typeof db = db): Promise<Invitation> {
    return withDbErrorTranslation(() =>
      tx.invitation.update({ where: { id }, data: { status: "REVOKED", revokedAt: new Date() } }),
    );
  },

  /**
   * The race-safe accept primitive (spec sections 12/44/45): an atomic
   * conditional UPDATE, not a read-then-write. `updateMany` with
   * `status: "PENDING"` in the `WHERE` clause is Postgres's own
   * row-level locking doing the real work — two concurrent callers
   * racing this same row can only ever have one `UPDATE` actually match
   * the row (the first to commit changes `status` away from `PENDING`,
   * so the second's `WHERE` clause matches zero rows) — no application
   * mutex, no `SELECT ... FOR UPDATE` needed, because a single
   * `UPDATE ... WHERE` is already atomic in Postgres. The caller checks
   * `result.count` — `1` means this call won the race, `0` means it
   * lost (or the invitation was already accepted/revoked by the time
   * this ran) — see `invitation-service.ts`'s `acceptInvitation()`.
   */
  async claimForAcceptance(
    id: string,
    acceptedByUserId: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<number> {
    const result = await withDbErrorTranslation(() =>
      tx.invitation.updateMany({
        where: { id, status: "PENDING" },
        data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId },
      }),
    );
    return result.count;
  },
};
