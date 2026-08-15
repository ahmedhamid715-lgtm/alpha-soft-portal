export type LogLevel = "debug" | "info" | "warn" | "error";

/** Ordered so `LOG_LEVELS.indexOf(a) >= LOG_LEVELS.indexOf(b)` means "a is at least as severe as b". */
export const LOG_LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

/**
 * Structured context attached to a log line. `userId`/`organizationId` are
 * optional because neither exists yet (Module 04/06) — future modules
 * should populate them via `logger.child({ userId, organizationId })`
 * rather than adding new logger methods.
 */
export interface LogContext {
  requestId?: string;
  userId?: string;
  organizationId?: string;
  operation?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Returns a new Logger that merges `context` into every subsequent call. */
  child(context: LogContext): Logger;
}
