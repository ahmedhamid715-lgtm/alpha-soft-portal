import "server-only";
import { z } from "zod";
import type { Organization, OrganizationMembership } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { withTransaction } from "@/lib/db/transaction";
import { parseOrThrow } from "@/lib/validation/parse";
import { ConflictError } from "@/lib/errors/app-error";
import { logger } from "@/lib/logging";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { userRepository, normalizeEmail } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";

/**
 * Business logic for organizations — the boundary between "raw input from
 * a caller" and "trusted data a repository can write." A service:
 *
 *   1. Validates input (Zod + `parseOrThrow` — repositories trust their
 *      caller, services don't trust theirs).
 *   2. Orchestrates one or more repositories, wrapping multi-write
 *      operations in `withTransaction()` when they must be atomic.
 *   3. Contains the actual business rule ("creating an organization always
 *      creates its first membership as owner") — a repository has no
 *      opinion about that, it just knows how to write rows.
 *
 * This is Module 03's one representative service (spec section 22) —
 * later modules add their own (`server/services/crm-service.ts`, etc.)
 * following this same shape, not by adding more functions here.
 *
 * **Deliberately kept free of any `@/lib/authorization`/
 * `@/lib/tenancy`/`@/lib/auth/session-guard` import** (Module 07): this
 * file is imported directly by `prisma/seed.ts`/`prisma/seed-rbac.ts`,
 * which run as a bare `tsx` process with no Next.js bundler in the loop.
 * `session-guard.ts` imports `next/navigation`, which — found by
 * actually running the seed script, not by inspection — throws
 * (`_react.default.createContext is not a function`) under that bare
 * process; anything importing it transitively breaks `npm run db:seed`.
 * `organization-management-service.ts` holds every authorized,
 * RBAC-integrated organization operation Module 07 adds — a new file, so
 * the seed script's import graph never touches that chain. See that
 * file's own top comment for the full reasoning.
 */

const slugSchema = z
  .string()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase, alphanumeric, and hyphen-separated (e.g. \"acme-co\").");

export const createOrganizationWithOwnerSchema = z.object({
  organization: z.object({
    name: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    slug: slugSchema,
    timezone: z.string().optional(),
    locale: z.string().optional(),
    currency: z.string().length(3).optional(),
  }),
  owner: z.object({
    email: z.string().email(),
    name: z.string().min(1).max(200),
  }),
});
export type CreateOrganizationWithOwnerInput = z.infer<typeof createOrganizationWithOwnerSchema>;

export interface CreateOrganizationWithOwnerResult {
  organization: Organization;
  membership: OrganizationMembership;
}

/**
 * The representative "creating an organization plus membership atomically"
 * example (spec section 21). If the owner user doesn't exist yet, it's
 * created in the same transaction; if they do (an existing user starting a
 * second organization), the existing row is reused. Either way, exactly
 * one thing can go wrong without leaving a half-created organization
 * behind — the whole operation commits or none of it does.
 */
export async function createOrganizationWithOwner(
  rawInput: unknown,
): Promise<CreateOrganizationWithOwnerResult> {
  const input = parseOrThrow(createOrganizationWithOwnerSchema, rawInput);

  const existingSlug = await organizationRepository.findBySlug(input.organization.slug);
  if (existingSlug) {
    throw new ConflictError(`An organization with the slug "${input.organization.slug}" already exists.`, {
      details: { field: "slug" },
    });
  }

  const result = await withTransaction(async (tx) => {
    const organization = await organizationRepository.create(
      { id: generateId(), ...input.organization },
      tx,
    );

    const existingUser = await userRepository.findByEmail(input.owner.email, tx);
    const owner =
      existingUser ??
      (await userRepository.create({ id: generateId(), email: input.owner.email, name: input.owner.name }, tx));

    const membership = await membershipRepository.create(
      { id: generateId(), organizationId: organization.id, userId: owner.id, role: "owner" },
      tx,
    );

    return { organization, membership };
  });

  logger.info("Organization created.", {
    operation: "organization.createWithOwner",
    organizationId: result.organization.id,
    slug: result.organization.slug,
  });

  return result;
}

/** Exposed for callers that already have a validated email and just need the normalized form (e.g. a lookup before calling the mutation above). */
export { normalizeEmail };

/** The slug validation schema, exposed for `organization-management-service.ts` (Module 07) to reuse — one canonical slug rule, not two. */
export { slugSchema };
