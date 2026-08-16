import "server-only";
import { z } from "zod";
import type { User } from "@/generated/prisma/client";
import { parseOrThrow } from "@/lib/validation/parse";
import { AuthenticationError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { events } from "@/lib/platform/events";
import { userRepository } from "@/server/repositories/user-repository";
import { getCurrentUser } from "@/lib/auth/session-guard";

/**
 * Self-service user profile (spec section 24) — deliberately separate
 * from `organization-service.ts`/`role-service.ts`: this is a person
 * managing their OWN global identity's presentation fields, never an
 * organization admin acting on someone else, and never anything
 * authentication-security-relevant. No `organizationId` parameter
 * exists anywhere in this file on purpose — there is nothing
 * tenant-scoped about a person's own name or timezone preference.
 *
 * What this deliberately CANNOT touch (spec section 24's own list):
 * `email`, `status`, `emailVerifiedAt` (Module 04's authentication
 * identity — an email change would need re-verification, which doesn't
 * exist yet), any `UserCredential`/`UserSession` row (Module 04's own
 * password-change/session-management mechanisms, untouched here), and
 * no `organizationId`/`role`/`membershipId` field exists on `User` at
 * all to accidentally expose (spec section 8's global-identity vs.
 * membership separation holds structurally, not just by convention).
 */

const updateProfileSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  avatarUrl: z.string().url().nullable().optional(),
  timezone: z.string().max(100).nullable().optional(),
  locale: z.string().max(20).nullable().optional(),
});

export async function updateOwnProfile(rawInput: unknown): Promise<User> {
  const identity = await getCurrentUser();
  if (!identity) throw new AuthenticationError();

  const input = parseOrThrow(updateProfileSchema, rawInput);
  const updated = await userRepository.updateProfile(identity.user.id, input);

  logger.info("Profile updated.", { operation: "profile.update", userId: identity.user.id });
  await events.emit("profile.updated", { userId: identity.user.id, fields: Object.keys(input) });

  return updated;
}
