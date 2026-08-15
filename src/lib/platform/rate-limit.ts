import "server-only";

/**
 * Rate-limit abstraction (spec sections 18 & 27). No surface in Module 01
 * actually needs rate limiting yet (there's no public API, no login form,
 * no AI chat), so this ships as an interface plus a no-op implementation —
 * enough for future route handlers to depend on the *shape* now and get a
 * real backend (Upstash Redis is the natural fit, given lib/platform/cache
 * will likely also want Redis) swapped in the moment a module needs it,
 * without touching call sites.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Requests permitted per window. */
  limit: number;
  /** Requests remaining in the current window. */
  remaining: number;
  /** When the current window resets. */
  resetAt: Date;
}

export interface RateLimiter {
  /** `key` is caller-defined — typically `${ip}:${route}` or `${userId}:${action}`. */
  check(key: string): Promise<RateLimitResult>;
}

export class NoopRateLimiter implements RateLimiter {
  async check(): Promise<RateLimitResult> {
    return { allowed: true, limit: Number.POSITIVE_INFINITY, remaining: Number.POSITIVE_INFINITY, resetAt: new Date(0) };
  }
}

export const rateLimiter: RateLimiter = new NoopRateLimiter();
