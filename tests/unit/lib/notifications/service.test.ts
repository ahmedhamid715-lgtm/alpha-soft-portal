import { describe, expect, it, vi } from "vitest";

// `service.ts` transitively imports `@/lib/auth/session-guard`, which
// imports `@/auth` (next-auth) — real, but its own module graph reaches
// `next/server` in a way plain Vitest (no Next.js runtime) can't
// resolve. Mocked the same way `audit-service.test.ts`/
// `session-guard.test.ts` already avoid this for every other service
// unit test that touches an identity-adjacent import — this file only
// exercises the pure `buildIdempotencyKey()` string function below, so
// the mock's actual behavior is never invoked.
vi.mock("@/lib/auth/session-guard", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => {
    throw new Error("no request scope in tests");
  }),
}));

const { buildIdempotencyKey } = await import("@/lib/notifications/service");

/**
 * `buildIdempotencyKey()` in isolation — the exact string format
 * `Notification.idempotencyKey`'s unique constraint depends on (spec
 * section 4.5). Database-level duplicate-prevention itself is proven by
 * `notification-service.test.ts`'s concurrent-`notify()` test; this file
 * only pins the format so a future refactor can't silently change it.
 */
describe("buildIdempotencyKey", () => {
  it("joins sourceEventType, sourceEntityId, and recipientUserId with ':'", () => {
    expect(buildIdempotencyKey("MembershipRemoved", "membership_1", "user_1")).toBe("MembershipRemoved:membership_1:user_1");
  });

  it("uses the literal 'none' when sourceEntityId is null — never an empty segment that could collide across different null-entity events", () => {
    expect(buildIdempotencyKey("PasswordResetCompleted", null, "user_1")).toBe("PasswordResetCompleted:none:user_1");
  });

  it("two different recipients of the same event produce two different keys — never a shared row two people race to own", () => {
    const a = buildIdempotencyKey("ownership.transferred", "membership_1", "user_a");
    const b = buildIdempotencyKey("ownership.transferred", "membership_1", "user_b");
    expect(a).not.toBe(b);
  });
});
