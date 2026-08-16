import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./client";
import { translatePrismaError } from "./errors";
import { logger } from "@/lib/logging";
import { isAppError } from "@/lib/errors/app-error";

export type TransactionClient = Prisma.TransactionClient;

/**
 * The one supported way to run multiple related writes atomically (spec
 * section 12/13). Wraps `db.$transaction` so every transaction gets
 * consistent error translation and logging without each call site
 * reimplementing a try/catch.
 *
 * **Only translates genuine, un-typed errors escaping Prisma** (spec
 * section 39's "do not expose raw database errors"). A callback that
 * deliberately throws its own `AppError` (a `NotFoundError` for "this
 * row doesn't exist," a `ValidationError` for a business-rule check run
 * *inside* the transaction) is re-thrown as-is — found by Module 07's
 * own testing, not by inspection: without this check, `NotFoundError`
 * is not a `PrismaClientKnownRequestError`, so `translatePrismaError()`
 * fell through to its generic `DatabaseError` catch-all, silently
 * turning a precise 404 into an opaque 500 for any transaction whose
 * callback threw a business-logic error rather than letting a raw
 * Prisma error escape. `withTenantContext()`
 * (`lib/tenancy/context.ts`) shares this exact fix for the same reason.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  try {
    return await db.$transaction(fn, options);
  } catch (error) {
    if (isAppError(error)) throw error;
    const appError = translatePrismaError(error);
    logger.error("Transaction failed.", {
      operation: "db.transaction",
      code: appError.code,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw appError;
  }
}
