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

/**
 * Fixed-window, in-memory rate limiter — the first *real* (non-no-op)
 * implementation of the interface above, added by Module 04 for the
 * authentication surface specifically (login, forgot-password, reset-
 * password, verify-email): "the authentication surface must be protected
 * more aggressively than normal API routes."
 *
 * In-memory, not Redis: this project has no Redis/Upstash configured
 * anywhere yet, and this module's job is to protect a single-instance
 * deployment's login endpoint, not to solve distributed rate limiting.
 * The known limitation — state resets on process restart, and doesn't
 * coordinate across multiple server instances — is real and is exactly
 * the "swap in a real backend the moment a module needs it" moment this
 * file's original comment anticipated. If Alpha OS ever deploys with
 * more than one Node process/instance sharing traffic, replace this
 * class with a Redis-backed one *without changing any call site* — that
 * portability is the entire reason this stays behind the `RateLimiter`
 * interface instead of being called directly.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.hits.set(key, { count: 1, resetAt });
      this.sweep(now);
      return { allowed: true, limit: this.limit, remaining: this.limit - 1, resetAt: new Date(resetAt) };
    }

    existing.count += 1;
    const allowed = existing.count <= this.limit;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - existing.count),
      resetAt: new Date(existing.resetAt),
    };
  }

  /** Opportunistic cleanup so the map doesn't grow unbounded over a long-running process — not a scheduled job, just piggybacked on new-window writes. */
  private sweep(now: number): void {
    if (this.hits.size < 10_000) return;
    for (const [key, value] of this.hits) {
      if (value.resetAt <= now) this.hits.delete(key);
    }
  }
}

/**
 * The authentication surface's rate limiter — 10 attempts per 15-minute
 * window per key. Callers key this by `${action}:${normalizedEmail}` (not
 * IP alone — a shared office/NAT IP shouldn't lock out every employee
 * because of one person's typos) — see `lib/auth` call sites. This is
 * deliberately separate from the general-purpose `rateLimiter` above
 * (still a no-op): auth needs real protection *now*; nothing else in the
 * app has a rate-limit-sensitive surface yet.
 */
export const authRateLimiter: RateLimiter = new InMemoryRateLimiter(10, 15 * 60 * 1000);
