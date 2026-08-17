import Link from "next/link";
import type { AuditEvent } from "@/generated/prisma/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge, type StatusBadgeProps } from "@/components/shared/status-badge";
import { describeAuditEvent } from "@/lib/audit/describe";
import { getAuditActionDefinition, isAuditActionKey } from "@/lib/audit/catalog";

function outcomeStatus(outcome: AuditEvent["outcome"]): StatusBadgeProps["status"] {
  switch (outcome) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
      return "destructive";
    case "DENIED":
      return "warning";
    default:
      return "neutral";
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeStyle: "medium" });

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm break-all">{value}</dd>
    </div>
  );
}

/**
 * Event detail (Phase 17) — a human-readable explanation FIRST, the raw
 * technical record second, `previousState`/`newState`/`metadata` last
 * and collapsed. "High-quality" here means a reader who is not this
 * codebase's author can understand what happened without decoding JSON —
 * spec Phase 17's explicit bar.
 *
 * `basePath` (`/admin/audit` or `/organizations/{id}/audit`) is what
 * makes the investigation-navigation links (Phase 18: actor → resource →
 * requestId → correlationId) point at the right scope's list view — the
 * component itself has no opinion on platform vs. organization.
 */
export function AuditEventDetail({ event, basePath }: { event: AuditEvent; basePath: string }) {
  const definition = isAuditActionKey(event.action) ? getAuditActionDefinition(event.action) : null;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What happened</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-base">{describeAuditEvent(event)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={outcomeStatus(event.outcome)}>{event.outcome}</StatusBadge>
            <StatusBadge status="neutral">{event.category}</StatusBadge>
            <time className="text-sm text-muted-foreground" dateTime={event.createdAt.toISOString()}>
              {dateTimeFormatter.format(event.createdAt)}
            </time>
          </div>
          {definition ? <p className="text-sm text-muted-foreground">{definition.description}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Action" value={<code className="text-xs">{event.action}</code>} />
            <Field label="Actor" value={event.actorDisplayName ?? (event.actorType === "SYSTEM" ? "System / unauthenticated" : "—")} />
            <Field
              label="Actor user"
              value={
                event.actorUserId ? (
                  <Link className="hover:underline" href={`${basePath}?actorUserId=${event.actorUserId}`}>
                    All events by this user →
                  </Link>
                ) : null
              }
            />
            <Field label="Resource" value={event.resourceName ?? null} />
            <Field
              label="Resource reference"
              value={
                event.resourceType && event.resourceId ? (
                  <Link className="hover:underline" href={`${basePath}?resourceType=${event.resourceType}&resourceId=${event.resourceId}`}>
                    All events for this {event.resourceType} →
                  </Link>
                ) : (
                  event.resourceType ?? null
                )
              }
            />
            <Field
              label="Request"
              value={
                <Link className="hover:underline" href={`${basePath}?requestId=${event.requestId}`}>
                  {event.requestId}
                </Link>
              }
            />
            <Field
              label="Correlation"
              value={
                <Link className="hover:underline" href={`${basePath}?correlationId=${event.correlationId}`}>
                  {event.correlationId}
                </Link>
              }
            />
            <Field label="IP address" value={event.ipAddress} />
            <Field label="User agent" value={event.userAgent} />
            <Field label="Event ID" value={<code className="text-xs">{event.id}</code>} />
          </dl>
        </CardContent>
      </Card>

      {event.previousState || event.newState || event.metadata ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Technical record</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {event.previousState || event.newState ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {event.previousState ? <JsonBlock label="Before" value={event.previousState} /> : null}
                {event.newState ? <JsonBlock label="After" value={event.newState} /> : null}
              </div>
            ) : null}
            {event.metadata ? <JsonBlock label="Additional context" value={event.metadata} /> : null}
            <p className="text-xs text-muted-foreground">
              Field-level changes only, never a full database row — and passed through redaction before storage, so
              credentials/tokens/secrets never appear here even if a caller accidentally included them. See{" "}
              <code>docs/architecture/audit-system.md</code>.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="group flex flex-col gap-2 rounded-md border border-border p-3">
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground group-open:mb-1">{label}</summary>
      <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
