import "server-only";

/**
 * Cache abstraction (spec section 25). No caching decisions are made in
 * Module 01 — caching must always be an explicit, deliberate choice by
 * the module that needs it, never a default. This interface exists so
 * that choice doesn't couple business code to a specific backend (Redis
 * is the likely production choice, given rate limiting will probably want
 * it too — see lib/platform/rate-limit.ts).
 *
 * The in-memory implementation below is a real, working cache (unlike the
 * jobs/events inline fallbacks) — safe for single-instance development,
 * but it does NOT share state across serverless instances or server
 * restarts. Do not rely on it for anything correctness-sensitive in
 * production; swap in a Redis-backed implementation before that matters.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete every key currently stored — for cache-invalidation-on-deploy style use, not per-entity invalidation. */
  clear(): Promise<void>;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
}

class InMemoryCache implements Cache {
  private readonly store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

export const cache: Cache = new InMemoryCache();
