import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db/client";
import { isDatabaseConfigured } from "@/config/environment";
import { generateId, isValidId } from "@/lib/utils/id";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { ConflictError } from "@/lib/errors/app-error";

/**
 * Real database integration tests (spec section 28/29) — no mocked
 * Prisma. `describe.skipIf` means this file SKIPS (not fails, not fakes a
 * pass) when `DATABASE_URL` isn't configured — the default in this
 * environment — and runs for real against whatever Postgres it points to
 * otherwise. See docs/architecture/database.md "Testing" for how to point
 * this at a real database locally.
 */
describe.skipIf(!isDatabaseConfigured)("Organization repository (database integration)", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length) {
      await db.organization.deleteMany({ where: { id: { in: createdIds } } });
      createdIds.length = 0;
    }
  });

  it("creates an organization with a real, valid UUIDv7 id and Timestamptz timestamps", async () => {
    const id = generateId();
    const org = await organizationRepository.create({
      id,
      name: "Test Co",
      displayName: "Test Co",
      slug: `test-co-${id}`,
    });
    createdIds.push(org.id);

    expect(org.id).toBe(id);
    expect(isValidId(org.id)).toBe(true);
    expect(org.createdAt).toBeInstanceOf(Date);
    expect(org.updatedAt).toBeInstanceOf(Date);
    expect(org.status).toBe("ACTIVE");
  });

  it("enforces slug uniqueness — a duplicate slug is a real constraint violation", async () => {
    const slug = `unique-slug-${generateId()}`;
    const first = await organizationRepository.create({
      id: generateId(),
      name: "First",
      displayName: "First",
      slug,
    });
    createdIds.push(first.id);

    await expect(
      organizationRepository.create({ id: generateId(), name: "Second", displayName: "Second", slug }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("archives (never deletes) — status becomes ARCHIVED and archivedAt is set", async () => {
    const org = await organizationRepository.create({
      id: generateId(),
      name: "To Archive",
      displayName: "To Archive",
      slug: `to-archive-${generateId()}`,
    });
    createdIds.push(org.id);

    const archived = await organizationRepository.archive(org.id);
    expect(archived.status).toBe("ARCHIVED");
    expect(archived.archivedAt).toBeInstanceOf(Date);

    // The row still exists — archiving is not deletion.
    const stillThere = await organizationRepository.findById(org.id);
    expect(stillThere).not.toBeNull();
  });

  it("findBySlug returns null for a slug that doesn't exist, not an error", async () => {
    const result = await organizationRepository.findBySlug(`does-not-exist-${generateId()}`);
    expect(result).toBeNull();
  });
});
