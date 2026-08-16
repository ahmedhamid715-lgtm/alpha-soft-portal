import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { tenantDb } from "./client";
import { translatePrismaError } from "@/lib/db/errors";
import { logger } from "@/lib/logging";
import { isAppError } from "@/lib/errors/app-error";

/**
 * `withTenantContext()` — the ONLY way any code in this codebase should
 * open a transaction against an RLS-protected table (spec sections
 * 10–15). It establishes the transaction-local Postgres settings RLS
 * policies read (`tenant_current_user_id()`,
 * `tenant_current_organization_id()`, `tenant_is_platform_context()` —
 * see the migration `20260817090000_row_level_security`), then runs the
 * caller's work inside that same transaction.
 *
 * **This function does not decide who the caller is allowed to act as.**
 * It trusts its `TenantContextInput` argument completely — the caller
 * (always Module 05's `resolveOrganizationContext()`/
 * `resolvePlatformContext()`, or a service function that already has a
 * verified `AuthorizationContext` in hand) is responsible for having
 * already established, via Module 05's authorization engine, that this
 * user genuinely has this organization/platform context. See
 * `docs/architecture/rls.md` "What RLS does and does not defend
 * against" — RLS is the second line of defense for code that already
 * has the *right* context and might have a bug (a forgotten `WHERE`
 * clause, a raw query run from an internal tool); it cannot protect
 * against the context-setting call itself being fed a forged value,
 * because that IS the trust boundary. Nothing downstream of
 * `withTenantContext()` needs to re-check tenant ownership — that is
 * the entire point of RLS being enforced by Postgres itself.
 *
 * Transaction-local (`set_config(..., true)`, equivalent to
 * `SET LOCAL`), not session-level — verified safe under connection
 * pooling: the settings apply only for the lifetime of this one
 * transaction and are gone the instant it commits or rolls back, even
 * though the underlying connection returns to the pool for reuse by a
 * completely different request. See `docs/architecture/rls.md`
 * "Connection pooling" for the real test that proves this, not just
 * asserts it.
 */
export interface TenantContextInput {
  /** The authenticated user's id, or `null` for a context with no resolvable identity (RLS then denies everything — see "fail closed" in rls.md). */
  userId: string | null;
  /** The organization this transaction's queries are scoped to, or `null` if none is established (e.g. resolving "which orgs do I belong to" itself — see the migration's `organization_memberships` SELECT policy). */
  organizationId: string | null;
  /** True only when resolved via `resolvePlatformContext()` with a genuine, ACTIVE platform-org membership — never inferred, never a default. */
  isPlatformStaff: boolean;
}

export type TenantTransactionClient = Prisma.TransactionClient;

export async function withTenantContext<T>(
  input: TenantContextInput,
  fn: (tx: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await tenantDb.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${input.userId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${input.organizationId ?? ""}, true)`;
      await tx.$executeRaw`SELECT set_config('app.is_platform', ${input.isPlatformStaff ? "true" : "false"}, true)`;
      return fn(tx);
    });
  } catch (error) {
    // A callback that deliberately throws its own `AppError` (a
    // `NotFoundError` for "this membership doesn't exist," etc.) is
    // re-thrown as-is, not mistranslated into a generic `DatabaseError`
    // — see `withTransaction()`'s identical fix/comment
    // (`lib/db/transaction.ts`) for why this check has to come first;
    // found by this module's own testing (`ownership-transfer-service.test.ts`).
    if (isAppError(error)) throw error;
    // Below this point: a raw Postgres RLS-policy violation (`new row
    // violates row-level security policy`, SQLSTATE 42501) that somehow
    // reaches this layer despite Module 05's own authorization check
    // already having blocked the attempt (defense in depth firing)
    // comes out as a safe, generic `DatabaseError` — never a raw
    // SQL/constraint-name leak. Should be unreachable in normal
    // operation; see rls.md "What RLS does and does not defend against."
    const appError = translatePrismaError(error);
    logger.error("Tenant-scoped transaction failed.", {
      operation: "tenancy.withTenantContext",
      code: appError.code,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw appError;
  }
}

/**
 * Updates `app.organization_id` mid-transaction — for the case where a
 * caller opens `withTenantContext()` *before* knowing which organization
 * applies (spec section 13: "do not assume the first organization
 * returned... is correct" — the caller's sole membership has to be
 * looked up first, non-circularly, via the `user_id = current_user_id()`
 * RLS clause), then needs subsequent queries in the SAME transaction
 * (role/permission lookups) scoped to the organization that lookup just
 * found. Still transaction-local (`set_config(..., true)`) — this does
 * not create a second transaction or a new connection.
 */
export async function setTenantOrganization(tx: TenantTransactionClient, organizationId: string | null): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.organization_id', ${organizationId ?? ""}, true)`;
}

/**
 * Updates `app.is_platform` mid-transaction. Deliberately NOT set `true`
 * up front by `resolvePlatformContext()` before it has actually verified
 * the caller holds a real, ACTIVE membership in the platform organization
 * — a transaction that started with `isPlatformStaff: true` optimistically
 * and turned out to belong to an unrelated user would over-broaden RLS
 * visibility for the rest of that transaction's queries, even though the
 * one bounded lookup that specific resolver happens to run today would
 * still have been safe (its `WHERE` clause is exact). Set this only after
 * verification succeeds, so the invariant holds regardless of what a
 * future caller adds inside the same transaction.
 */
export async function setTenantPlatformStaff(tx: TenantTransactionClient, isPlatformStaff: boolean): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.is_platform', ${isPlatformStaff ? "true" : "false"}, true)`;
}
