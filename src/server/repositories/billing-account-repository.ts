import "server-only";
import type { BillingAccount, BillingAccountStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Data access for `BillingAccount` — RLS-protected (see
 * billing-data-model.md), so every read/write here must run inside
 * `withTenantContext()` when called on behalf of a real user — the
 * service layer (`billing-account-service.ts`) owns that, not this
 * file.
 */
export const billingAccountRepository = {
  async findByOrganizationId(organizationId: string, tx: TransactionClient | typeof db = db): Promise<BillingAccount | null> {
    return withDbErrorTranslation(() => tx.billingAccount.findUnique({ where: { organizationId } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<BillingAccount | null> {
    return withDbErrorTranslation(() => tx.billingAccount.findUnique({ where: { id } }));
  },

  /** Platform-only — reads across every organization, always inside a platform-context `withTenantContext()`. */
  async findByProviderCustomerId(provider: "STRIPE", providerCustomerId: string, tx: TransactionClient | typeof db = db): Promise<BillingAccount | null> {
    return withDbErrorTranslation(() => tx.billingAccount.findUnique({ where: { provider_providerCustomerId: { provider, providerCustomerId } } }));
  },

  async create(
    input: { id: string; organizationId: string; currency: string; provider: "STRIPE"; providerCustomerId: string },
    tx: TransactionClient | typeof db = db,
  ): Promise<BillingAccount> {
    return withDbErrorTranslation(() =>
      tx.billingAccount.create({
        data: {
          id: input.id,
          organizationId: input.organizationId,
          currency: input.currency,
          provider: input.provider,
          providerCustomerId: input.providerCustomerId,
        },
      }),
    );
  },

  async updateStatus(id: string, status: BillingAccountStatus, tx: TransactionClient | typeof db = db): Promise<BillingAccount> {
    return withDbErrorTranslation(() => tx.billingAccount.update({ where: { id }, data: { status } }));
  },
};
