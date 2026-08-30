import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { ConflictError, DatabaseError, NotFoundError } from "@/lib/errors/app-error";

/**
 * Database error translation (spec section 13 & 14). Raw Prisma errors —
 * with their SQL fragments, constraint names, and internal error codes —
 * must never reach an API response. This is the one place that knowledge
 * lives; call it from every repository/service catch block instead of
 * letting a `PrismaClientKnownRequestError` propagate untranslated.
 *
 * The full underlying error is preserved as `cause` on the returned
 * AppError, so `logger.error(..., { error })` and the dev-only `debug`
 * block in API responses (see lib/errors/api-response.ts) still carry the
 * real diagnostic detail — safety and debuggability aren't in tension
 * here, they're just routed to different audiences.
 */
/**
 * The `@prisma/adapter-pg` driver adapter wraps a raw Postgres error it
 * has no specific P2xxx code for (a GIST `EXCLUDE` violation, a
 * deadlock — Prisma has no native concept of either) in a GENERIC known-
 * request-error code (observed live as `P2039`, not one of Prisma's own
 * documented codes) — the real SQLSTATE is nested underneath, at
 * `error.meta.driverAdapterError.cause.originalCode`. Live-verified
 * (Build 21's own security review) by forcing a genuine concurrent
 * `crm_sales_goals_no_overlapping_active_period` race and inspecting
 * the raw error before this function's own translation — the outer
 * `.code` is NOT `"23P01"`/`"40P01"` directly, despite Prisma's own
 * console log line printing the real SQLSTATE (from this same nested
 * field) as if it were the top-level code.
 */
function rawPostgresCode(error: Prisma.PrismaClientKnownRequestError): string | undefined {
  const meta = error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined;
  const code = meta?.driverAdapterError?.cause?.originalCode;
  return typeof code === "string" ? code : undefined;
}

export function translatePrismaError(error: unknown): DatabaseError | ConflictError | NotFoundError {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002": {
        const target = Array.isArray(error.meta?.target) ? error.meta.target.join(", ") : undefined;
        return new ConflictError("A record with this value already exists.", {
          details: target ? { field: target } : undefined,
          cause: error,
        });
      }
      case "P2025":
        return new NotFoundError("Record", { cause: error });
      default: {
        // `exclusion_violation` (23P01) and `deadlock_detected` (40P01)
        // — a CHECK violation (23514) deliberately stays a generic
        // `DatabaseError` here (a caller input-shape bug, not a
        // "someone else already has/is claiming this" race). Without
        // this check, the LOSING side of a real concurrent
        // `createGoal()` race got an unhelpful generic `DatabaseError`
        // instead of the same clean `ConflictError` the app-layer
        // pre-check already gives the common (non-racing) case —
        // correctness was never at risk (the constraint always wins
        // either way), only the error message quality was.
        const pgCode = rawPostgresCode(error);
        if (pgCode === "23P01" || pgCode === "40P01") {
          return new ConflictError("A record with this value already exists.", { cause: error });
        }
        return new DatabaseError(undefined, { cause: error });
      }
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new DatabaseError("Could not connect to the database.", { cause: error });
  }

  return new DatabaseError(undefined, { cause: error });
}

/** Wrap a Prisma call so any thrown error comes out as a translated AppError. */
export async function withDbErrorTranslation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw translatePrismaError(error);
  }
}
