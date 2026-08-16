import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId } from "@/lib/utils/id";
import { userRepository } from "@/server/repositories/user-repository";
import { sessionRepository } from "@/server/repositories/session-repository";
import { sessionService } from "@/server/services/session-service";

describe.skipIf(!isDatabaseConfigured)("Session service (database integration)", () => {
  const userIds: string[] = [];

  afterEach(async () => {
    if (userIds.length) await db.user.deleteMany({ where: { id: { in: userIds } } });
    userIds.length = 0;
  });

  async function makeUserWithSessions(count: number) {
    const id = generateId();
    const user = await userRepository.create({ id, email: `session-test-${id}@example.com`, name: "Session Test" });
    userIds.push(id);
    const sessions = [];
    for (let i = 0; i < count; i++) {
      sessions.push(
        await sessionRepository.create({
          id: generateId(),
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );
    }
    return { user, sessions };
  }

  it("revokeSession marks a specific session revoked with the given reason", async () => {
    const { sessions } = await makeUserWithSessions(1);
    await sessionService.revokeSession(sessions[0].id, "admin_revoked");

    const found = await sessionRepository.findById(sessions[0].id);
    expect(found?.revokedAt).toBeInstanceOf(Date);
    expect(found?.revokedReason).toBe("admin_revoked");
  });

  it("revokeAllSessions revokes every live session for a user", async () => {
    const { user, sessions } = await makeUserWithSessions(3);
    const revokedCount = await sessionService.revokeAllSessions(user.id, "user_logout");
    expect(revokedCount).toBe(3);

    for (const session of sessions) {
      const found = await sessionRepository.findById(session.id);
      expect(found?.revokedAt).toBeInstanceOf(Date);
    }
  });

  it("revokeAllSessions can spare one session (the one making the current request)", async () => {
    const { user, sessions } = await makeUserWithSessions(2);
    await sessionService.revokeAllSessions(user.id, "user_logout", sessions[0].id);

    const spared = await sessionRepository.findById(sessions[0].id);
    const revoked = await sessionRepository.findById(sessions[1].id);
    expect(spared?.revokedAt).toBeNull();
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it("listActiveSessions excludes revoked and expired sessions", async () => {
    const { user, sessions } = await makeUserWithSessions(2);
    await sessionService.revokeSession(sessions[0].id, "user_logout");
    await db.userSession.create({
      data: { id: generateId(), userId: user.id, expiresAt: new Date(Date.now() - 1000) }, // already expired
    });

    const active = await sessionService.listActiveSessions(user.id);
    expect(active.map((s) => s.id)).toEqual([sessions[1].id]);
  });
});
