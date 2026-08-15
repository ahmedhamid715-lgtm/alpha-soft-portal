import { v7 as uuidv7, validate as isValidUuid } from "uuid";

/**
 * ID strategy (spec section 31): UUIDv7 for every entity's primary key,
 * everywhere in the application — not auto-increment integers, not plain
 * UUIDv4.
 *
 * Why UUIDv7 specifically:
 *   - Time-ordered (the first 48 bits are a millisecond Unix timestamp),
 *     so IDs sort chronologically and B-tree index locality stays good —
 *     unlike UUIDv4, which is fully random and fragments indexes under
 *     high insert volume.
 *   - Globally unique without a central sequence, so IDs generated
 *     client-side, in a background job, or across services never collide
 *     — important once Module 06 (multi-tenancy) and Module 54
 *     (integrations) are generating IDs outside a single database.
 *   - Safe to expose in URLs (unlike sequential integers, a UUIDv7 does
 *     not reveal row count or let a caller enumerate `/customers/1`,
 *     `/customers/2`, ...).
 *
 * Every future Prisma model should default its `id` field to this
 * generator (`@default(dbgenerated())` is not portable across Postgres
 * versions for v7 specifically, so IDs are generated in application code
 * via this function, not by the database) — see docs/architecture/database.md.
 */
export function generateId(): string {
  return uuidv7();
}

export function isValidId(value: string): boolean {
  return isValidUuid(value);
}
