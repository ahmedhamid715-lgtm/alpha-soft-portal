import "server-only";
import { serverEnv } from "@/config/environment";
import { AppError, toAppError } from "./app-error";

/**
 * The API response contract every route handler in Alpha OS follows
 * (spec section 15). One shape for success, one shape for failure —
 * nothing downstream (client code, tests, future modules) should ever
 * have to branch on a bespoke per-endpoint response format.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  requestId: string;
  /** Present only outside production — never rely on this in client code. */
  debug?: { name: string; stack?: string; cause?: string };
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export function apiSuccess<T>(data: T, init?: number | ResponseInit): Response {
  const body: ApiSuccessResponse<T> = { success: true, data };
  return Response.json(body, typeof init === "number" ? { status: init } : init);
}

/**
 * Convert any thrown value into the standard error response. Always safe
 * to call with an `unknown` catch-clause value — non-`AppError` errors are
 * normalized to a generic `InternalServerError` before serialization, so
 * a raw driver/library error can never leak its message to a client.
 */
export function apiError(error: unknown, requestId: string): Response {
  const appError: AppError = toAppError(error);

  const body: ApiErrorResponse = {
    success: false,
    error: {
      ...appError.toSafeJSON(),
      requestId,
      ...(serverEnv.NODE_ENV !== "production"
        ? { debug: buildDebugInfo(appError) }
        : {}),
    },
  };

  return Response.json(body, { status: appError.statusCode });
}

function buildDebugInfo(error: AppError): ApiErrorBody["debug"] {
  return {
    name: error.name,
    stack: error.stack,
    cause: error.cause !== undefined ? safeStringify(error.cause) : undefined,
  };
}

function safeStringify(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
