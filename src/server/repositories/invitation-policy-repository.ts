import "server-only";
import type { OrganizationInvitationPolicy } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { generateId } from "@/lib/utils/id";

/**
 * Data access for `OrganizationInvitationPolicy` (Module 12). Lazily
 * created — see the model's own doc comment in `schema.prisma` — so
 * `findByOrganizationId()` returning `null` is the normal, expected
 * state for the vast majority of organizations that have never
 * customized their invitation policy; it is not an error condition
 * callers need to guard against, it's the "use every default" case.
 */
export const invitationPolicyRepository = {
  async findByOrganizationId(
    organizationId: string,
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationInvitationPolicy | null> {
    return withDbErrorTranslation(() => tx.organizationInvitationPolicy.findUnique({ where: { organizationId } }));
  },

  /**
   * Creates the row on first customization, updates it on every
   * subsequent one — the row's existence itself signals "this
   * organization has touched its defaults," which
   * `organization-security-service.ts`'s `getInvitationPolicy()` uses to
   * distinguish "explicitly kept at default" from "never configured" in
   * its own response shape.
   */
  async upsert(
    input: {
      organizationId: string;
      requireOwnerForInvitations: boolean;
      allowedDomains: string[];
      blockedDomains: string[];
      invitationExpiryHours: number;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<OrganizationInvitationPolicy> {
    return withDbErrorTranslation(() =>
      tx.organizationInvitationPolicy.upsert({
        where: { organizationId: input.organizationId },
        create: {
          id: generateId(),
          organizationId: input.organizationId,
          requireOwnerForInvitations: input.requireOwnerForInvitations,
          allowedDomains: input.allowedDomains,
          blockedDomains: input.blockedDomains,
          invitationExpiryHours: input.invitationExpiryHours,
        },
        update: {
          requireOwnerForInvitations: input.requireOwnerForInvitations,
          allowedDomains: input.allowedDomains,
          blockedDomains: input.blockedDomains,
          invitationExpiryHours: input.invitationExpiryHours,
        },
      }),
    );
  },
};
