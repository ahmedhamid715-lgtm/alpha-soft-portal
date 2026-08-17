# Audit security & trust model

This document states, explicitly and without exaggeration, what the
audit system does and does not guarantee — spec Phase 8's mandate: "Do
not falsely claim that an audit table is immutable if a privileged
database administrator can still alter it. Document the exact trust
model." See `audit-system.md` for the design rationale behind each of
these controls; this file is the honest accounting of what they add up
to.

## What "append-only" actually means here

Two independent layers, neither a substitute for the other:

1. **Application layer**: `src/server/repositories/audit-event-repository.ts`
   exports no `update()`/`delete()` function of any kind. No Server
   Action, Route Handler, or service function in this codebase can
   modify or remove an `AuditEvent` row — because the code path to do so
   does not exist.
2. **Database layer**: the restricted `alpha_os_app` role (every real
   application query, including the audit system's own reads/writes)
   has `UPDATE`/`DELETE` explicitly `REVOKE`d on `audit_events`
   (migration `20260818090000_audit_system`), and no RLS `UPDATE`/`DELETE`
   policy exists on the table at all. Under `FORCE ROW LEVEL SECURITY`,
   zero applicable policies for a command means zero rows ever match it
   — this is enforced by Postgres itself, not by application code
   remembering to check something.

**What this does NOT protect against**: the `DATABASE_URL` superuser
role (`ahmed` locally; the equivalent production role) has
`rolbypassrls = true` and full table privileges. That role runs
migrations, seeds, and is the one credential capable of directly
`UPDATE`ing or `DELETE`ing an `audit_events` row via `psql` or a
one-off script. **This system does not claim cryptographic or
database-level tamper-*proofing* against a privileged database
administrator** — see "Tamper evidence" below for why that guarantee
was evaluated and deliberately not built. What it does guarantee: no
*application code path*, and no role the *application itself*
authenticates as, can modify or delete an audit record. A compromised
application server, a bug in a future module, or a malicious tenant
cannot tamper with the audit trail. A compromised database superuser
credential is a different, more severe incident — and one no
application-layer control can fully defend against for *any* table, not
just this one.

## Tamper evidence — evaluated, not implemented

Spec Phase 9 asked for a real evaluation of cryptographic tamper
evidence (hash-chaining), not a default "no." The evaluation:

- A per-row hash chain (`hash = H(previous_hash || row_data)`) requires
  a strict, serialized write order — two concurrent audit writes racing
  to compute their hash from the "current last row" can both read the
  same predecessor and produce two valid-looking but conflicting chains,
  silently breaking the guarantee the chain exists to provide. Enforcing
  strict serialization at platform scale (every organization's writes
  interleaved) means either a single global write lock (a real
  throughput bottleneck on a table designed for high insert volume) or a
  materially more complex per-tenant chaining scheme this module has no
  concrete requirement driving it to build.
- Even a correctly-implemented chain does not defend against the actual
  threat this document already concedes is out of scope: a privileged
  database administrator who can write a row can also recompute and
  rewrite the chain from that point forward. A hash chain raises the
  bar against an attacker with *application-level* write access trying
  to quietly edit history in place (a real, if narrow, value) — it does
  not raise the bar against the superuser case at all.
- No current compliance requirement (spec section 43's own list) this
  module is scoped against requires cryptographic tamper-evidence today.

**Conclusion**: not implemented in Module 08. If a future requirement
(a specific compliance certification, an external audit) needs it, the
concrete design starting point is a per-organization hash chain (not
global — sidesteps the cross-tenant serialization cost) with the chain
verification exposed as an explicit, on-demand check (not a background
job pretending to guarantee something it can't enforce continuously).
Do not add a `previousHash`/`hash` column "because it sounds enterprise"
without that concrete driver — this is precisely the anti-pattern spec
Phase 9 warned against.

## Access control matrix

Four permissions, two independent scopes — see `rbac.md` for the general
permission model, `audit-system.md` "Authorization model" for why four
keys instead of one flag-gated key:

| Permission | Scope | Grants |
|---|---|---|
| `audit.read` | ORGANIZATION | View this organization's own audit trail (`/organizations/{id}/audit`). |
| `audit.export` | ORGANIZATION | Export this organization's own audit trail as CSV. |
| `audit.readPlatform` | PLATFORM | View platform-wide events (`/admin/audit`) — never a customer organization's own trail. |
| `audit.exportPlatform` | PLATFORM | Export platform-wide events as CSV. |

Held by (system roles, `src/lib/authorization/roles.ts`):

| Role | `audit.read` | `audit.export` | `audit.readPlatform` | `audit.exportPlatform` |
|---|---|---|---|---|
| `owner`, `admin` (any organization) | ✅ | ✅ | | |
| `manager`, `member`, `viewer`, `customer` | | | | |
| `platform_owner`, `platform_admin` | | | ✅ | ✅ |
| `support_admin` | | | ✅ | |
| `support_agent` | | | | |

**"Platform admin ≠ unlimited customer-org access" is structural, not a
convention.** `audit.readPlatform`/`audit.exportPlatform` do not grant
visibility into any specific customer organization's own audit trail —
`lib/audit/query.ts`'s platform-scope functions are hard-coded to
`organizationId IS NULL OR organizationId = <the platform org>`, never
an arbitrary organization id, regardless of what a client sends. A
platform admin who also needs to investigate a specific customer
organization's activity does so through that organization's own
`/organizations/{id}/audit` — which still requires `audit.read` for
*that* organization specifically (platform staff are not automatically
granted it). Verified in `tests/integration/db/audit-service.test.ts`
and `tests/e2e/audit-security.spec.ts`, not just asserted.

## Redaction

Every `previousState`/`newState`/`metadata` object is passed through
`lib/audit/redact.ts` immediately before the repository ever sees it —
callers are never trusted to have pre-redacted anything. Pattern (see
`redact.ts`'s own doc comment for the full reasoning and the
over-redaction guard): password/passwd/secret/token/api-key/
authorization/session-id/cookie/private-key/encryption-key/signing-key/
credit-card/card-number/cvv/ssn, matched by key name, case-insensitive,
depth-bounded at 8, array-aware.

**What redaction does not do**: it cannot redact a secret embedded
*inside* a free-text field it has no reason to suspect (e.g. a
`resourceName` that happens to contain a password because a caller
built it carelessly). Every mutation this module wires audit calls into
was reviewed to confirm no free-text field derived from raw,
un-vetted input is ever passed as `resourceName`/`resourceType` — those
come from server-resolved display names (a user's `name`, an
organization's `displayName`), never directly from a request body.

## IP address / User-Agent — best-effort, not authoritative

`ipAddress` is read from the `x-forwarded-for` header via
`headers()` inside a Server Action's call chain — **never validated
against a trusted-proxy allowlist**, because none exists in this
codebase's current deployment model (see `rls.md` for the equivalent
caveat on rate limiting). A client can send an arbitrary
`X-Forwarded-For` value if it reaches the application directly; in a
real deployment behind a proxy that itself sets this header
authoritatively, only the proxy's own value survives — this module does
not add trusted-proxy logic to make that promise true. `ipAddress`/
`userAgent` are investigative signals for a human reviewing the audit
log, **never an authorization input** — no permission or rate-limit
decision anywhere in this codebase reads them. Capture is
best-effort by design: `resolveRequestMetadata()` in `service.ts` never
throws (a missing/unavailable request scope resolves to `null`/`null`),
so a header read failure can never turn into a lost audit write for a
mandatory event.

## Privacy

No raw request body, no raw headers beyond the single best-effort IP/UA
read above, and no cookies are ever stored. `previousState`/`newState`
are field-level diffs of specific, named fields a service function
explicitly passes — never a full row serialization — see
`audit-system.md` "State-change capture."

## What a future module must not do

- Must not create its own audit table — see `audit-system.md`
  "Future-module contract."
- Must not call `auditEventRepository` directly — only through
  `lib/audit/service.ts`'s `audit.recordSuccess()`/`recordFailure()`/
  `recordDenied()`, which is what makes actor resolution, redaction, and
  request/correlation-id assignment automatic and structurally
  impossible to skip.
- Must not pass a client-supplied value as `resourceName` without first
  confirming it can't smuggle a secret through redaction's blind spot
  described above.
