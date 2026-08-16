import "server-only";
import type { UserCredential } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/** Data access for `UserCredential` — see prisma/schema.prisma for why this is a separate table from `User`. */
export const credentialRepository = {
  async create(
    input: { id: string; userId: string; passwordHash: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<UserCredential> {
    return withDbErrorTranslation(() =>
      tx.userCredential.create({
        data: { id: input.id, userId: input.userId, passwordHash: input.passwordHash },
      }),
    );
  },

  async findByUserId(userId: string): Promise<UserCredential | null> {
    return withDbErrorTranslation(() => db.userCredential.findUnique({ where: { userId } }));
  },

  async updatePassword(userId: string, passwordHash: string): Promise<UserCredential> {
    return withDbErrorTranslation(() =>
      db.userCredential.update({ where: { userId }, data: { passwordHash } }),
    );
  },
};
