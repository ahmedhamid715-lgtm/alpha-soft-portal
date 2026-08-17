# Auditing

How to record an audit event from a future module. See
`docs/architecture/audit-system.md` for the full design rationale,
`docs/architecture/audit-events.md` for the current catalog, and
`docs/architecture/audit-security.md` for the trust model — this page is
the practical "how do I actually call this" reference.

**No future business module may create its own audit table or query
`AuditEvent` directly.** Every audited action goes through
`src/lib/audit/service.ts`'s `audit` object. This is what makes actor
resolution, redaction, and request/correlation-id assignment automatic
— and structurally impossible to skip.

## 1. Add a catalog entry (if one doesn't already exist)

Every action string must exist in `src/lib/audit/catalog.ts`'s
`AUDIT_CATALOG` before you can reference it — `audit.record()`'s `action`
parameter is typed against `AuditActionKey`, so an unlisted string is a
compile error, not a runtime surprise.

```ts
// src/lib/audit/catalog.ts
export const AUDIT_CATALOG = {
  // ...existing entries...
  "ticket.created": action("DATA", "A support ticket was created."),
} as const satisfies Record<string, AuditActionDefinition>;
```

Naming: lowercase dot-notation, `resource.action` or
`resource.subresource.action` — reuse the existing vocabulary
(`created`/`updated`/`suspended`/`removed`/...) rather than inventing a
new verb for a concept the catalog already has a word for. Pick the
closest-fitting `AuditCategory` from the existing eleven — don't add a
twelfth without a real reason.

## 2. Call `audit.recordSuccess()` / `recordFailure()` / `recordDenied()`

```ts
import { audit } from "@/lib/audit/service";

// Inside a service function, after (or as part of) the mutation:
await audit.recordSuccess({
  action: "ticket.created",
  organizationId: ticket.organizationId, // server-verified, never a raw client value
  resourceType: "ticket",
  resourceId: ticket.id,
  resourceName: ticket.subject,
  newState: { status: ticket.status, priority: ticket.priority },
});
```

You do **not** need to supply: the actor (resolved from
`getCurrentUser()` automatically — see "Actor resolution" below),
`requestId`/`correlationId` (minted fresh unless you have a real reason
to thread an existing one), or redaction (`previousState`/`newState`/
`metadata` are redacted automatically before the row is written).

Use `recordFailure()` for an attempted operation that failed for a
reason other than an authorization decision; `recordDenied()`
specifically for a permission check that rejected the request.

## 3. Decide: atomic or best-effort?

This is the one thing you must decide deliberately per call site — see
`audit-system.md`'s "Transactional consistency & failure semantics"
table for the full reasoning and every existing example.

**Atomic (fail-closed)** — for any security-sensitive or
business-significant mutation, pass the SAME transaction the mutation
itself runs in:

```ts
await withTenantContext(tenantInputFor(context), async (tx) => {
  const ticket = await ticketRepository.create({ ... }, tx);
  await audit.recordSuccess({
    action: "ticket.created",
    organizationId: ticket.organizationId,
    resourceType: "ticket",
    resourceId: ticket.id,
    tx, // <-- same transaction as the mutation
  });
  return ticket;
});
```

If the audit write fails here, `audit.record()` throws — the whole
transaction (mutation included) rolls back. This is intentional: "the
mutation succeeded but its audit record silently failed" is exactly
what this module exists to prevent for anything that matters.

**Best-effort (non-blocking)** — for a genuinely low-sensitivity or
pre-transaction event (a login, a self-service profile edit), omit `tx`
and wrap the call in your own try/catch:

```ts
await audit.recordSuccess({ action: "profile.updated", resourceType: "user", resourceId: user.id })
  .catch((error) => {
    console.error("[audit] failed to record profile.updated", error);
  });
```

Never write a bare `try { await audit.record(...) } catch {}` — every
catch block must log, so a failed audit write is still observable
somewhere even when it isn't allowed to block the user-facing operation.

## 4. Actor resolution — you don't supply it, with one exception

`audit.record()` always resolves the acting user from
`getCurrentUser()` internally. There is no `actorUserId` parameter in
its public API — a caller cannot assert "record this as user X" for any
X other than whoever the real session belongs to.

The one narrow escape hatch is `knownActor: { userId, displayName }`,
for the rare case where the real actor is known from a just-completed,
trusted server-side operation but `getCurrentUser()` can't see it yet
(e.g. immediately after `signIn()`, before the session cookie has round-
tripped back to the browser — see `(public)/login/actions.ts`). Only use
this when you have a genuine value your OWN code resolved server-side
(a repository lookup, a verified token's `userId`) — never a
client-supplied field.

## 5. What NOT to pass

- **Never a full database row** as `previousState`/`newState` — only
  the specific fields that actually changed. See `audit-system.md`
  "State-change capture."
- **Never a credential, token, or secret** — redaction catches the
  common key names automatically, but don't rely on it as your only
  line of defense; avoid putting secrets in scope for an audited object
  at all.
- **Never noisy UI-interaction events** — "user opened a dropdown" is
  not a security-sensitive or business-significant action. Audit
  *mutations*, not every click. See `audit-events.md`'s existing catalog
  for the granularity this module settled on.

## Testing

- **Unit**: if your change adds catalog entries or touches
  `describeAuditEvent()`'s human-readable formatting, add cases to
  `tests/unit/lib/audit/catalog.test.ts` / `describe-event.test.ts`.
- **Integration**: `tests/integration/db/audit-service.test.ts` is the
  template for testing a real service function's audit call site
  end-to-end (real Postgres, mocked identity) — see its
  "role-service.ts's createCustomRole() writes a role.created audit
  event" test for the pattern to copy for your own new mutation.
- **E2E**: if you add a new audited UI surface, extend
  `tests/e2e/audit.spec.ts` (functional), `audit-accessibility.spec.ts`
  (axe-core), or `audit-security.spec.ts` (adversarial) rather than
  starting a fourth audit-adjacent spec file.
