/**
 * Centralized application error model (spec section 14).
 *
 * Every error that crosses an API boundary should be — or be translated
 * into — one of these classes before it's serialized. This is what lets
 * `toApiResponse()` (see api-response.ts) produce a consistent contract
 * without every route handler reinventing status-code mapping.
 *
 * `isOperational` distinguishes errors the application anticipated and
 * handled on purpose (bad input, missing record, expired session) from
 * everything else (a bug, an unhandled exception, a driver crash). Safe,
 * user-facing messages only make sense for the former — see
 * `toSafeJSON()`.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;
  readonly isOperational: boolean = true;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.details = options?.details;
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * Safe, client-facing serialization. Never includes stack traces, SQL,
   * secrets, or filesystem paths — see docs/architecture/errors.md for the
   * rules this method exists to enforce.
   */
  toSafeJSON(): { code: string; message: string; details?: Record<string, unknown> } {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_ERROR";
  readonly statusCode = 400;
}

export class AuthenticationError extends AppError {
  readonly code = "AUTHENTICATION_ERROR";
  readonly statusCode = 401;

  constructor(message = "Authentication is required.", options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(message, options);
  }
}

export class AuthorizationError extends AppError {
  readonly code = "AUTHORIZATION_ERROR";
  readonly statusCode = 403;

  constructor(message = "You do not have permission to perform this action.", options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(message, options);
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly statusCode = 404;

  constructor(resource = "Resource", options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(`${resource} was not found.`, options);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT";
  readonly statusCode = 409;
}

export class RateLimitError extends AppError {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly statusCode = 429;

  constructor(message = "Too many requests. Please try again shortly.", options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(message, options);
  }
}

/**
 * A database operation failed. `isOperational` is still `true` because a
 * database error (constraint violation, connection refused, timeout) is a
 * known failure mode we deliberately catch and translate — see
 * lib/db/errors.ts — rather than an unexpected bug in application logic.
 * The *message* is always the safe, generic one; diagnostic detail goes to
 * the logger only, never to `details`.
 */
export class DatabaseError extends AppError {
  readonly code = "DATABASE_ERROR";
  readonly statusCode = 500;

  constructor(message = "A database error occurred.", options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(message, options);
  }
}

export class ExternalServiceError extends AppError {
  readonly code = "EXTERNAL_SERVICE_ERROR";
  readonly statusCode = 502;

  constructor(service: string, options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super(`The ${service} service is currently unavailable.`, options);
  }
}

/**
 * The catch-all for anything unanticipated. `isOperational` is `false` —
 * this represents a genuine bug or unhandled condition, not a known
 * failure mode, so the safe response is always the generic message below
 * regardless of what the underlying error said.
 */
export class InternalServerError extends AppError {
  readonly code = "INTERNAL_SERVER_ERROR";
  readonly statusCode = 500;
  override readonly isOperational = false;

  constructor(options?: { details?: Record<string, unknown>; cause?: unknown }) {
    super("An unexpected error occurred.", options);
  }
}

/** True for any of the typed AppError subclasses above. */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * Normalize any thrown value into an AppError. Unknown errors become an
 * InternalServerError (isOperational: false) rather than being passed
 * through — nothing downstream should ever have to handle a raw,
 * untyped `unknown`.
 */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  return new InternalServerError({ cause: error });
}
