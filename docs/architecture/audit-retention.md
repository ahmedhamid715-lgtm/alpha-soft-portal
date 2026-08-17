# Audit retention

**No automated deletion ships in Module 08.** Spec Phase 20's own
caution: "Do NOT blindly delete old audit records." Nothing in this
codebase runs a scheduled job, a cron, or a cascading delete against
`audit_events`. Every row written stays until a human, with a documented
reason, deliberately removes it via a manual, reviewed process (below)
— not a background process nobody is watching.

## Why documented-only, not automated

- No current compliance requirement (spec section 43's own list —
  SOC 2, GDPR, HIPAA-adjacent obligations) this module is scoped against
  actually specifies a retention *window* yet. Building a deletion job
  against a number nobody has committed to is exactly the kind of
  "sounds enterprise" over-build spec Phase 9's warning (about hash
  chains, but the same principle) applies to just as much here.
- An audit trail is evidence. The failure mode of deleting it too early
  (an incident investigated six months from now finds a gap) is far
  worse than the failure mode of deleting it too late (storage cost).
  Given that asymmetry, the default posture is: retain, until a real
  retention requirement with an actual number and an actual legal/
  compliance owner exists.
- Automated deletion against a table this module also positions as
  "evidence when something goes wrong" is a genuine footgun to build
  without a corresponding recovery/backup story already in place — out
  of scope for this module to invent unilaterally.

## Recommended retention posture (documented, not enforced)

A starting point for whoever eventually owns this decision — not a
default this codebase currently applies:

| Category | Suggested minimum retention | Reasoning |
|---|---|---|
| `SECURITY`, `AUTHORIZATION` (denials, suspicious activity) | 2+ years | Security incident investigations routinely look back further than a typical "operational" log window. |
| `ORGANIZATION`, `MEMBERSHIP`, `ROLE`, `INVITATION` (business-significant mutations) | 1–2 years, or per the organization's own contractual/compliance terms | These are the events most likely to matter to an external audit (SOC 2 change-management evidence, for instance). |
| `AUTHENTICATION` (login success/failure, logout) | 90 days – 1 year | Highest volume category; still useful for anomaly investigation over a shorter window than the above. |
| `COMPLIANCE` (`audit.export.created`) | Same as the category being exported, or longer | An export record is itself evidence of who accessed what. |

These are starting numbers for a real policy discussion, not a
recommendation this module asserts is correct for any specific
compliance framework — that determination belongs to whoever is
accountable for the actual certification/regulatory obligation.

## If/when automated retention is built

Design constraints for that future work, so it doesn't have to
rediscover them:

- **Never a hard `DELETE` triggered by ordinary application traffic.** A
  retention job is an explicit, scheduled, reviewed operational process
  (Module 01's `lib/platform/jobs.ts` abstraction is the natural home),
  not a side effect of any user-facing action.
- **Prefer archival over deletion** where feasible — moving expired rows
  to cold storage (a separate table, an export to object storage)
  preserves the evidence for a genuine incident investigation that
  predates the retention window, while keeping the hot `audit_events`
  table's query performance bounded (see "Performance & partitioning" in
  `audit-system.md`).
- **The deletion job itself must be audited** — a `retention.purge`-style
  catalog entry (extend `lib/audit/catalog.ts`, never invent an
  ad hoc string) recording what was purged, by what policy, and when —
  otherwise the retention process becomes the one action in this system
  with no trail of its own.
- **Respect the append-only guarantee's own scope.** The
  `REVOKE UPDATE, DELETE ... FROM alpha_os_app` grant (see
  `audit-security.md`) intentionally blocks the *application* role from
  deleting rows — a real retention job needs either a separate,
  narrowly-scoped role with `DELETE` granted specifically for this
  purpose (audited, rotated, not the everyday application credential),
  or must run as a controlled migration/maintenance operation, never as
  part of normal request-serving code.
- **Per-organization retention overrides** are a realistic future need
  (a customer's contract specifies a longer window than the platform
  default) — design the policy as organization-configurable from the
  start rather than a single global constant, even if the first
  implementation only ships the global default.

## Manual purge (today's only supported path)

If a row genuinely must be removed today (a legal request, a mistake in
a test/seed script reaching a non-development database), it is a
manual, reviewed database operation performed by someone holding the
superuser/migration credential — the same credential capable of the
`UPDATE`/`DELETE` `audit-security.md` already documents as outside this
system's tamper-resistance guarantee. This is not a workflow the
application exposes, and doing it should be rare enough that it never
needs to be.
