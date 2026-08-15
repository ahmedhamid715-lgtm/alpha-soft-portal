import { serverEnv } from "@/config/environment";
import { redact } from "./redact";
import { LOG_LEVELS, type LogContext, type Logger, type LogLevel } from "./types";

/**
 * Structured stdout/stderr logger. Behind the `Logger` interface so a real
 * observability provider (Module 58) can replace this implementation
 * without touching any call site — every log call in the codebase should
 * go through `logger` (see index.ts), never `console.log` directly.
 */
export class ConsoleLogger implements Logger {
  constructor(private readonly baseContext: LogContext = {}) {}

  debug(message: string, context?: LogContext): void {
    this.write("debug", message, context);
  }
  info(message: string, context?: LogContext): void {
    this.write("info", message, context);
  }
  warn(message: string, context?: LogContext): void {
    this.write("warn", message, context);
  }
  error(message: string, context?: LogContext): void {
    this.write("error", message, context);
  }

  child(context: LogContext): Logger {
    return new ConsoleLogger({ ...this.baseContext, ...context });
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.isEnabled(level)) return;

    const mergedContext = { ...this.baseContext, ...context };
    const redactedContext = redact(mergedContext) as Record<string, unknown>;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      environment: serverEnv.NODE_ENV,
      ...redactedContext,
    };

    const line = JSON.stringify(entry);
    // Route warn/error to stderr so log-forwarding pipelines can split by
    // stream without parsing the `level` field.
    if (level === "warn" || level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  private isEnabled(level: LogLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(serverEnv.LOG_LEVEL);
  }
}
