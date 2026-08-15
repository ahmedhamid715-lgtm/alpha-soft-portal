import "server-only";
import { ConsoleLogger } from "./console-logger";
import type { Logger } from "./types";

export type { Logger, LogContext, LogLevel } from "./types";

/**
 * Application-wide logger singleton. Import this — never call
 * `console.log`/`console.error` directly outside this module.
 *
 * For request-scoped logging (the common case in route handlers), use
 * `logger.child({ requestId })` so every line for that request carries the
 * correlation ID automatically instead of passing it to every call.
 */
export const logger: Logger = new ConsoleLogger();
