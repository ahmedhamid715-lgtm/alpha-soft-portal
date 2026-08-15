/**
 * Soft-delete and archiving conventions (spec sections 32 & 33).
 *
 * No table exists yet to apply these to — Module 03 (Database
 * Architecture) is where real entities land — but the *policy* is decided
 * now so every future model picks consistently instead of each module
 * inventing its own deletion semantics:
 *
 *   - **Hard delete**: the row is actually gone. Reserved for data with no
 *     compliance/audit value and no downstream references — e.g. an
 *     expired session token, a stale cache row.
 *   - **Soft delete** (`Softdeletable`): the row stays, marked deleted.
 *     Use for anything a user "deletes" through the UI where accidental
 *     deletion, audit trail, or restore is a real concern — customers,
 *     projects, documents, tasks. Queries must filter `deletedAt: null`
 *     by default (Module 03's repository layer enforces this — a model
 *     being soft-deletable is not optional to respect).
 *   - **Archive** (`Archivable`): the record is inactive but not deleted
 *     at all — it stays fully queryable, just excluded from default
 *     "active" views. Use for records whose historical value is the
 *     point: invoices, closed deals, completed projects. Never hard- or
 *     soft-delete financial records — see docs/architecture/database.md.
 *
 * A single entity can implement more than one of these (e.g. a Project is
 * `Archivable` when completed, `Softdeletable` if a user removes it).
 */

export interface Softdeletable {
  deletedAt: Date | null;
  deletedBy: string | null;
}

export type LifecycleStatus = "active" | "inactive" | "archived";

export interface Archivable {
  status: LifecycleStatus;
  archivedAt: Date | null;
}
