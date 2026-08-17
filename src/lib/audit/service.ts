import "server-only";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import type { AuditActorType, AuditEvent } from "@/generated/prisma/client";
import { generateId } from "@/lib/utils/id";
import { getCurrentUser } from "@/lib/auth/session-guard";
import { auditEventRepository } from "@/server/repositories/audit-event-repository";
import type { TransactionClient } from "@/lib/db/transaction";
import { db } from "@/lib/db/client";
import { redactAuditObject } from "./redact";
import { getAuditActionDefinition, type AuditActionKey } from "./catalog";

/**
 * The centralized audit service (Module 08, spec Phase 4) — the ONLY
 * way any code in this codebase writes an `AuditEvent` row. No future
 * module may create its own audit table or write to this one directly
 * (`docs/development/auditing.md`).
 *
 * **Trust model** (spec Phase 5): the actor is ALWAYS resolved from
 * `getCurrentUser()` — this module's own trusted session lookup, the
 * same one every protected Server Action already calls — never from a
 * parameter a caller supplies. There is no `actorUserId` parameter
 * anywhere in this file's public API; a caller cannot say "record this
 * as user X" for any X other than whoever the real session belongs to.
 * The one narrow escape hatch (`unauthenticatedActorDisplayName`) exists
 * for the one real case with no session to resolve — a failed login —
 * and it can only ever populate a free-text label, never `actorUserId`.
 *
 * **Why every function here can throw**: see
 * `docs/architecture/audit-system.md` "Transactional consistency &
 * failure semantics" — whether a failure here should roll back the
 * caller's transaction or just be logged is a decision this module
 * makes per call site, not inside this file. A `withTenantContext()`
 * callback that calls `audit.recordSuccess(...)` without its own
 * try/catch gets fail-closed behavior for free (an audit-write failure
 * throws, the whole transaction — business mutation included — rolls
 * back); a call site that explicitly wants best-effort semantics wraps
 * the call in its own try/catch and logs. Nothing in this file silently
 * swallows a failure.
 */

export interface RecordAuditEventInput {
  action: AuditActionKey;
  /** Verified server-side context the caller already has — e.g. `context.organizationId` from a just-completed `requirePermission()` call. Never a raw client-supplied value. Omit for organization-less events. */
  organizationId?: string | null;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  /** Field-level diff only — never a full row. Redacted automatically. */
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  /** Small, bounded, action-specific context. Redacted automatically. */
  metadata?: Record<string, unknown>;
  /** Threads an existing request/correlation id (e.g. from a Route Handler that already has one) — omit to mint a fresh pair. */
  requestId?: string;
  correlationId?: string;
  /** Run inside an already-open transaction — required for every mutation `audit-system.md`'s table marks atomic. */
  tx?: TransactionClient;
  /**
   * Overrides actor resolution for the one narrow class of call site
   * where the real actor is already known from a just-completed, trusted
   * server-side operation, but `getCurrentUser()` can't see it yet —
   * concretely, `auth.login.success`/`auth.login.failure`: Auth.js sets
   * the session cookie on the outgoing response, not observable within
   * the same Server Action execution that just called `signIn()` (see
   * `(public)/login/actions.ts`'s own doc comment on this). MUST only
   * ever be built from a value the calling service function derived
   * itself — e.g. the row `userRepository.findByEmail()` returned
   * immediately after `signIn()` resolved, never a client-supplied
   * field, form value, or request body. There is deliberately no
   * version of this parameter reachable from a Server Action directly —
   * only `src/server/services/*` call `audit.record()`.
   */
  knownActor?: { userId: string; displayName: string | null };
  /**
   * The one narrow escape hatch for "no session exists, and no real
   * account was found either" (a failed login against an email with no
   * matching account). Populates `actorDisplayName` only — never
   * `actorUserId`, never treated as a real identity. Omit for every
   * other call; the real, session-resolved actor is used automatically.
   */
  unauthenticatedActorDisplayName?: string;
}

async function resolveActor(
  knownActor?: { userId: string; displayName: string | null },
  unauthenticatedActorDisplayName?: string,
): Promise<{ actorType: AuditActorType; actorUserId: string | null; actorDisplayName: string | null }> {
  if (knownActor) {
    return { actorType: "USER", actorUserId: knownActor.userId, actorDisplayName: knownActor.displayName };
  }
  const identity = await getCurrentUser();
  if (identity) {
    return { actorType: "USER", actorUserId: identity.user.id, actorDisplayName: identity.user.name };
  }
  return { actorType: "SYSTEM", actorUserId: null, actorDisplayName: unauthenticatedActorDisplayName ?? null };
}

/**
 * Best-effort, never throws — `ipAddress`/`userAgent` are investigative
 * metadata only (see audit-system.md "IP/UA handling"), never worth
 * failing an audit write over. `headers()` throws when called outside a
 * request scope (e.g. a future script/cron context); caught here rather
 * than pushed onto every call site.
 */
async function resolveRequestMetadata(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for");
    const ipAddress = forwardedFor ? forwardedFor.split(",")[0]!.trim() : null;
    const userAgent = h.get("user-agent");
    return { ipAddress, userAgent: userAgent ? userAgent.slice(0, 255) : null };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
}

async function record(
  input: RecordAuditEventInput,
  outcome: "SUCCESS" | "FAILURE" | "DENIED",
): Promise<AuditEvent> {
  const definition = getAuditActionDefinition(input.action);
  const [actor, requestMeta] = await Promise.all([
    resolveActor(input.knownActor, input.unauthenticatedActorDisplayName),
    resolveRequestMetadata(),
  ]);

  const requestId = input.requestId ?? randomUUID();
  const correlationId = input.correlationId ?? requestId;

  return auditEventRepository.create(
    {
      id: generateId(),
      organizationId: input.organizationId ?? null,
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      actorServiceId: null,
      actorDisplayName: actor.actorDisplayName,
      action: input.action,
      category: definition.category,
      outcome,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      resourceName: input.resourceName ?? null,
      previousState: input.previousState ? (redactAuditObject(input.previousState) as Record<string, unknown>) : null,
      newState: input.newState ? (redactAuditObject(input.newState) as Record<string, unknown>) : null,
      metadata: input.metadata ? (redactAuditObject(input.metadata) as Record<string, unknown>) : null,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      requestId,
      correlationId,
    },
    input.tx ?? db,
  );
}

export const audit = {
  /** A mutation completed successfully. */
  recordSuccess(input: RecordAuditEventInput): Promise<AuditEvent> {
    return record(input, "SUCCESS");
  },
  /** An attempted operation failed for a reason other than an authorization decision (e.g. wrong password). */
  recordFailure(input: RecordAuditEventInput): Promise<AuditEvent> {
    return record(input, "FAILURE");
  },
  /** A permission check explicitly denied the request. */
  recordDenied(input: RecordAuditEventInput): Promise<AuditEvent> {
    return record(input, "DENIED");
  },
};
