import "server-only";
import { logger } from "@/lib/logging";

/**
 * Background job abstraction (spec section 23). Future modules will need
 * async work for emails, reports, AI processing, SEO crawling,
 * notifications, imports/exports, and integration syncs. Module 01
 * establishes the *contract* — a real queue (e.g. a Postgres-backed queue,
 * or a managed service) is Module 57's job (Background Jobs).
 *
 * The inline `InlineJobQueue` below runs handlers immediately in-process.
 * It exists so early modules can depend on `JobQueue` without blocking on
 * infrastructure that doesn't exist yet — it is explicitly NOT durable
 * (no retry, no persistence, lost on process restart) and must not be
 * mistaken for the real thing. Anything that actually needs reliability
 * should wait for Module 57.
 */
export interface JobPayloadMap {
  // Populated by future modules, e.g.:
  // "email.send": { to: string; templateId: string };
  // "report.generate": { reportId: string };
  [jobName: string]: unknown;
}

export interface JobHandler<T> {
  (payload: T): Promise<void>;
}

export interface JobQueue {
  register<K extends keyof JobPayloadMap>(jobName: K, handler: JobHandler<JobPayloadMap[K]>): void;
  enqueue<K extends keyof JobPayloadMap>(jobName: K, payload: JobPayloadMap[K]): Promise<void>;
}

class InlineJobQueue implements JobQueue {
  private readonly handlers = new Map<string, JobHandler<unknown>>();

  register<K extends keyof JobPayloadMap>(jobName: K, handler: JobHandler<JobPayloadMap[K]>): void {
    this.handlers.set(jobName as string, handler as JobHandler<unknown>);
  }

  async enqueue<K extends keyof JobPayloadMap>(jobName: K, payload: JobPayloadMap[K]): Promise<void> {
    const handler = this.handlers.get(jobName as string);
    if (!handler) {
      logger.warn("Job enqueued with no registered handler — dropped.", { operation: "jobs.enqueue", jobName: String(jobName) });
      return;
    }

    try {
      await handler(payload);
    } catch (error) {
      // No retry, no dead-letter queue — this is the inline fallback, not
      // the real thing. Module 57 owns actual failure handling.
      logger.error("Inline job handler threw.", {
        operation: "jobs.enqueue",
        jobName: String(jobName),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const jobs: JobQueue = new InlineJobQueue();
