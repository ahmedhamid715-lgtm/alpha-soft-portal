import { describe, expect, it, vi, afterEach } from "vitest";
import { InMemoryRateLimiter } from "@/lib/platform/rate-limit";

describe("InMemoryRateLimiter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the limit", async () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      const result = await limiter.check("key-a");
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks requests once the limit is exceeded within the window", async () => {
    const limiter = new InMemoryRateLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) await limiter.check("key-b");
    const fourth = await limiter.check("key-b");
    expect(fourth.allowed).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it("tracks each key independently — one key's limit doesn't affect another's", async () => {
    const limiter = new InMemoryRateLimiter(1, 60_000);
    await limiter.check("key-c");
    const blocked = await limiter.check("key-c");
    const otherKey = await limiter.check("key-d");
    expect(blocked.allowed).toBe(false);
    expect(otherKey.allowed).toBe(true);
  });

  it("resets after the window elapses", async () => {
    vi.useFakeTimers();
    const limiter = new InMemoryRateLimiter(1, 1000);
    await limiter.check("key-e");
    const blocked = await limiter.check("key-e");
    expect(blocked.allowed).toBe(false);

    vi.advanceTimersByTime(1001);
    const afterWindow = await limiter.check("key-e");
    expect(afterWindow.allowed).toBe(true);
  });

  it("reports decreasing `remaining` as requests are consumed", async () => {
    const limiter = new InMemoryRateLimiter(5, 60_000);
    const first = await limiter.check("key-f");
    const second = await limiter.check("key-f");
    expect(first.remaining).toBe(4);
    expect(second.remaining).toBe(3);
  });
});
