import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./client";
import { translatePrismaError } from "./errors";
import { logger } from "@/lib/logging";

export type TransactionClient = Prisma.TransactionClient;

/**
 * The one supported way to run multiple related writes atomically (spec
 * section 12/13). Wraps `db.$transaction` so every transaction gets
 * consistent error translation and logging without each call site
 * reimplementing a try/catch.
 */
export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  try {
    return await db.$transaction(fn, options);
  } catch (error) {
    const appError = translatePrismaError(error);
    logger.error("Transaction failed.", {
      operation: "db.transaction",
      code: appError.code,
      cause: error instanceof Error ? error.message : String(error),
    });
    throw appError;
  }
}
