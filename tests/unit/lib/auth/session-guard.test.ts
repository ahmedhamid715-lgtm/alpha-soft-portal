import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Direct unit coverage of `requireAuthenticatedUser()` / `getCurrentUser()`
 * — the throw-based authoritative boundary every protected Server Action
 * and Route Handler calls (as opposed to `requireAuthenticatedPage()`,
 * covered end-to-end via `tests/e2e/auth.spec.ts` and this audit's direct
 * HTTP tests against `(protected)/layout.tsx`). Module 04's shipped scope
 * has no real mutating Server Action yet to exercise this over HTTP (only
 * placeholder pages) — this test exercises the exact function directly,
 * with `auth()` and the repositories mocked, across the five session
 * states this project's security audit requires: NO SESSION, INVALID
 * (`auth()` resolves but has no sessionId — a tampered/foreign JWT never
 * reaches here at all, since Auth.js's own JWE decryption already
 * rejects it before this module runs), EXPIRED, REVOKED, VALID.
 */
const authMock = vi.fn();
const findByIdMock = vi.fn();
const userFindByIdMock = vi.fn();
const touchMock = vi.fn();

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/server/repositories/session-repository", () => ({
  sessionRepository: { findById: findByIdMock, touch: touchMock },
}));
vi.mock("@/server/repositories/user-repository", () => ({
  userRepository: { findById: userFindByIdMock },
}));
vi.mock("@/server/repositories/membership-repository", () => ({
  membershipRepository: { findByOrganizationAndUser: vi.fn(), listForUser: vi.fn() },
}));

const ACTIVE_USER = { id: "user-1", status: "ACTIVE", email: "a@example.com" };

describe("requireAuthenticatedUser / getCurrentUser — direct boundary tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("NO SESSION — auth() resolves with no session at all", async () => {
    authMock.mockResolvedValue(null);
    const { getCurrentUser, requireAuthenticatedUser } = await import("@/lib/auth/session-guard");
    expect(await getCurrentUser()).toBeNull();
    await expect(requireAuthenticatedUser()).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("INVALID — auth() resolves a JWT with a user id but no sessionId claim", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" } });
    const { getCurrentUser, requireAuthenticatedUser } = await import("@/lib/auth/session-guard");
    expect(await getCurrentUser()).toBeNull();
    expect(findByIdMock).not.toHaveBeenCalled(); // never even queries the DB for a claim shaped like this
    await expect(requireAuthenticatedUser()).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("EXPIRED — a real UserSession row exists but its expiresAt is in the past", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" }, sessionId: "session-1" });
    findByIdMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() - 60_000),
      lastActiveAt: new Date(),
    });
    const { getCurrentUser, requireAuthenticatedUser } = await import("@/lib/auth/session-guard");
    expect(await getCurrentUser()).toBeNull();
    expect(userFindByIdMock).not.toHaveBeenCalled(); // denied before ever touching the user record
    await expect(requireAuthenticatedUser()).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("REVOKED — a real UserSession row exists but revokedAt is set", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" }, sessionId: "session-1" });
    findByIdMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
      lastActiveAt: new Date(),
    });
    const { getCurrentUser, requireAuthenticatedUser } = await import("@/lib/auth/session-guard");
    expect(await getCurrentUser()).toBeNull();
    await expect(requireAuthenticatedUser()).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("VALID — a live UserSession row and an ACTIVE user resolve a real identity", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" }, sessionId: "session-1" });
    findByIdMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastActiveAt: new Date(),
    });
    userFindByIdMock.mockResolvedValue(ACTIVE_USER);
    const { getCurrentUser, requireAuthenticatedUser } = await import("@/lib/auth/session-guard");
    expect(await getCurrentUser()).toEqual({ user: ACTIVE_USER, sessionId: "session-1" });
    await expect(requireAuthenticatedUser()).resolves.toEqual({ user: ACTIVE_USER, sessionId: "session-1" });
  });

  it("VALID session but a non-ACTIVE user (e.g. suspended mid-session) is denied", async () => {
    authMock.mockResolvedValue({ user: { id: "user-1" }, sessionId: "session-1" });
    findByIdMock.mockResolvedValue({
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      lastActiveAt: new Date(),
    });
    userFindByIdMock.mockResolvedValue({ ...ACTIVE_USER, status: "SUSPENDED" });
    const { getCurrentUser } = await import("@/lib/auth/session-guard");
    expect(await getCurrentUser()).toBeNull();
  });
});
