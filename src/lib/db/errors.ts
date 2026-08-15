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
      default:
        return new DatabaseError(undefined, { cause: error });
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
