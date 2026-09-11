/**
 * The canonical audit event catalog (Module 08, spec Phase 3) — the
 * single source of truth for every audit action key that exists in
 * Alpha OS. Nothing else hand-types an action string: `audit.record()`
 * (`service.ts`) requires a key from this catalog, the audit UI's
 * category filter and event-detail human-readable line
 * (`describeEvent()`, `query.ts`) both read FROM it.
 *
 * Naming convention: lowercase dot-notation, `resource.action` or
 * `resource.subresource.action` — `organization.member.role_changed`,
 * not `MemberRoleChanged` or `member_role_changed`. This is deliberately
 * different from `lib/platform/events.ts`'s own PascalCase convention
 * (`RoleCreated`) — see `docs/architecture/audit-system.md` "Naming
 * inconsistency, inherited and closed here" for why: this catalog is the
 * first canonical, enforced naming authority for *audit* events
 * specifically; it does not rename any existing `events.emit()` call.
 *
 * Every future module extends this object — it never hand-invents a
 * parallel action string. See `docs/development/auditing.md`.
 */
import type { AuditCategory } from "@/generated/prisma/client";

export interface AuditActionDefinition {
  category: AuditCategory;
  /** One sentence, for the audit UI's category legend and this file's own documentation — not shown per-event (see `describeEvent()` in `query.ts` for the per-event human-readable line). */
  description: string;
  /**
   * True for an action this module names now but has no real call site
   * for yet — same "reserved" convention `permissions.ts` established
   * (spec section 8's own precedent): a future two-phase ownership
   * transfer, a future explicit "suspicious login" detector. Seeded so a
   * future module has a real catalog entry to reference, never the
   * subject of an actual `audit.record()` call in this module's code.
   */
  reserved?: boolean;
}

function action(category: AuditCategory, description: string, reserved = false): AuditActionDefinition {
  return { category, description, reserved };
}

export const AUDIT_CATALOG = {
  // --- Authentication (Module 04) ---
  "auth.login.success": action("AUTHENTICATION", "A user successfully signed in."),
  "auth.login.failure": action("AUTHENTICATION", "A sign-in attempt failed (wrong credentials, unknown account, or suspended account)."),
  "auth.logout": action("AUTHENTICATION", "A user signed out."),
  "auth.session.revoked": action("AUTHENTICATION", "One or more sessions were revoked (e.g. after a password reset)."),

  // --- Authorization (Module 05) ---
  "security.authorization.denied": action("SECURITY", "A permission check denied the request."),
  "security.suspicious_login.denied": action("SECURITY", "A sign-in was denied for a suspicious-activity reason.", true),

  // --- Roles (Module 05) ---
  "role.created": action("ROLE", "A custom organization role was created."),
  "role.updated": action("ROLE", "A custom organization role's name, description, or permissions were changed."),
  "role.deleted": action("ROLE", "A custom organization role was deleted."),

  // --- Organizations (Module 07) ---
  "organization.created": action("ORGANIZATION", "An organization was created."),
  "organization.updated": action("ORGANIZATION", "An organization's profile was updated."),
  "organization.suspended": action("ORGANIZATION", "An organization was suspended."),
  "organization.reactivated": action("ORGANIZATION", "A suspended organization was reactivated."),
  "organization.archived": action("ORGANIZATION", "An organization was archived."),

  // --- Ownership (Module 07) ---
  "organization.owner.transfer_started": action("ORGANIZATION", "Ownership transfer was initiated (reserved for a future two-step transfer flow — today's transfer is a single atomic operation, see organization.owner.transfer_completed).", true),
  "organization.owner.transfer_completed": action("ORGANIZATION", "Organization ownership was transferred to a different member."),

  // --- Invitations (Module 07) ---
  "organization.member.invited": action("INVITATION", "A person was invited to join an organization."),
  "organization.member.invitation.accepted": action("INVITATION", "An invitation was accepted."),
  "organization.member.invitation.revoked": action("INVITATION", "A pending invitation was revoked."),
  "organization.member.invitation.resent": action("INVITATION", "A pending invitation was resent with a new token."),

  // --- Membership lifecycle (Module 07) ---
  "organization.member.role_changed": action("ROLE", "A member's role within an organization was changed."),
  "organization.member.suspended": action("MEMBERSHIP", "A member's access to an organization was suspended."),
  "organization.member.reactivated": action("MEMBERSHIP", "A suspended member's access was restored."),
  "organization.member.removed": action("MEMBERSHIP", "A member was removed from an organization."),

  // --- Profile (Module 07) ---
  "profile.updated": action("DATA", "A user updated their own profile (name, avatar, timezone, or locale — never credentials or membership)."),

  // --- User management (Module 10) — administrative actions platform
  // staff take on ANOTHER person's global `User` record, distinct from
  // `profile.updated` (self-service, Module 07) and from
  // `organization.member.*` (membership-scoped, one organization).
  // `ADMINISTRATION`, matching the same category `notification.*.changed`
  // already uses for platform-staff-on-someone-else's-account actions.
  "user.created": action("ADMINISTRATION", "Platform staff created a new platform user record."),
  "user.updated": action("ADMINISTRATION", "Platform staff edited another user's profile."),
  "user.suspended": action("ADMINISTRATION", "Platform staff suspended a user's global account."),
  "user.reactivated": action("ADMINISTRATION", "Platform staff reactivated a suspended or deactivated user's global account."),
  "user.deactivated": action("ADMINISTRATION", "Platform staff deactivated a user's global account (never a hard delete — see data-modeling.md)."),

  // --- Organization security & governance (Module 12) ---
  "organization.invitation_policy.updated": action("ORGANIZATION", "An organization's invitation/security governance policy (owner-only invites, allowed/blocked domains, invitation expiry) was changed."),

  // --- Billing (Module 13) — every sensitive billing action produces
  // exactly one of these (spec §30). `billing.payment_method.updated`
  // is `reserved` — Alpha OS never directly observes a raw payment-
  // method change (Stripe's Billing Portal handles the entire flow
  // without a distinct webhook this module consumes; see
  // billing-webhooks.md "Intentionally unsupported events") — seeded so
  // a future module adding real payment-method tracking has a real
  // catalog entry to reference, the same "reserved" convention
  // `permissions.ts` established.
  "billing.account.created": action("BILLING", "An organization's billing account was created."),
  "billing.account.updated": action("BILLING", "An organization's billing account status changed (e.g. suspended, closed)."),
  "billing.subscription.created": action("BILLING", "A subscription was created for an organization."),
  "billing.subscription.updated": action("BILLING", "A subscription's plan, items, or period changed."),
  "billing.subscription.canceled": action("BILLING", "A subscription was canceled (at period end or immediately)."),
  "billing.subscription.resumed": action("BILLING", "A subscription scheduled for cancellation was resumed — Alpha OS's own name for what Module 14's spec calls \"reactivated\"; see subscription-lifecycle.md for why CANCELED→ACTIVE is never the same operation as undoing a still-pending CANCEL_AT_PERIOD_END."),
  // Module 14 — was `reserved: true` in Module 13 (no live call site);
  // now real, from `changeSubscriptionPlan()`'s in-place upgrade/
  // downgrade (never the earlier module's own "always a fresh Checkout
  // Session" path, which would double-subscribe an existing customer —
  // see subscription-lifecycle.md "The in-place change bug Module 13
  // left behind").
  "billing.plan.changed": action("BILLING", "An organization's subscription plan/price changed."),
  "billing.plan.catalog_updated": action("BILLING", "A platform administrator created, edited, or deactivated a plan/price in the catalog."),
  "billing.payment_method.updated": action("BILLING", "An organization's payment method changed.", true),
  "billing.invoice.created": action("BILLING", "An invoice was created."),
  "billing.payment.succeeded": action("BILLING", "A payment succeeded."),
  "billing.payment.failed": action("BILLING", "A payment attempt failed."),
  "billing.refund.created": action("BILLING", "A refund was issued on a payment."),

  // --- Billing operations (Module 14) ---
  "billing.credit.issued": action("BILLING", "A credit was issued to an organization's ledger."),
  "billing.credit.adjusted": action("BILLING", "A compensating (reversal/correction) entry was recorded against an earlier credit ledger entry — never a mutation of the original."),
  "billing.trial.extended": action("BILLING", "A subscription's trial period was extended by platform staff."),
  "billing.payment.retry_requested": action("BILLING", "A retry of a failed invoice payment was requested — records the request; the actual outcome (succeeded/failed again) arrives via the normal invoice.paid/payment_failed webhook, same as every other provider-mediated mutation in this module."),
  "billing.webhook.failed": action("BILLING", "A billing webhook event failed to process (see BillingWebhookEvent.error for the safe, sanitized reason)."),
  "billing.report.exported": action("BILLING", "A platform financial report (invoices, payments, refunds, credits, AR aging, or MRR) was exported as CSV."),
  "billing.reconciliation.divergence_detected": action("BILLING", "A manual reconciliation check found a real divergence between Alpha OS and the provider for an organization's subscription. Deliberately NOT recorded for a routine 'no divergence' check — see billing-reconciliation.md, the same 'audit the specific outcome, not every routine read' discipline billing.webhook.processed's own reserved entry already establishes."),
  // `billing.webhook.processed` is deliberately `reserved` — a
  // SUCCESSFUL webhook's real effect is already captured by whichever
  // specific action it produced (`billing.subscription.updated`,
  // `billing.invoice.created`, `billing.payment.succeeded`, ...); a
  // second, generic "a webhook happened" entry for every one of those
  // would be pure duplication, not a new signal — the same "no audit
  // events for redundant/meaningless entries" restraint Module 09's own
  // catalog comment already documents for mark-read events. Seeded so a
  // future module with a genuine use for a raw processed-count signal
  // has a real key to reference.
  "billing.webhook.processed": action("BILLING", "A billing webhook event was processed (see the specific domain action it produced for the real effect).", true),

  // --- Compliance / this module's own actions ---
  "audit.export.created": action("COMPLIANCE", "An audit trail export was generated."),

  // --- Notifications (Module 09) — deliberately NOT auditing every
  // mark-read/mark-unread (noise — the same "no audit events for
  // meaningless UI interactions" discipline this module already applies
  // elsewhere; see docs/architecture/notification-security.md "What's
  // audited, and what isn't"). Reuses DATA/SYSTEM/ADMINISTRATION rather
  // than adding a new AuditCategory enum value for one module's four
  // actions — same restraint this catalog already applies to indexes
  // and tamper-evidence: don't add structure without a concrete need.
  "notification.archived": action("DATA", "A user archived one of their own notifications."),
  "notification.preference.updated": action("DATA", "A user changed a notification preference."),
  "notification.delivery.failed": action("SYSTEM", "A notification delivery attempt reached a terminal failure state."),
  "notification.test.sent": action("ADMINISTRATION", "Platform staff sent a test notification to verify provider configuration."),
  "notification.provider.changed": action("ADMINISTRATION", "The configured email provider was changed.", true),

  // --- Module 17 — AI support chat. Individual messages are NOT
  // audited (the AiMessage table itself is the full, durable transcript
  // — audit isn't a second copy of it, the same "audit the outcome, not
  // every routine action" discipline `billing.reconciliation.divergence_detected`
  // already establishes). Conversation lifecycle and rate-limit denials
  // ARE audited — real, business/security-significant events.
  "ai.conversation.started": action("AI", "A user started a new AI support-chat conversation."),
  "ai.conversation.closed": action("AI", "An AI support-chat conversation was closed."),
  "ai.rate_limit.exceeded": action("AI", "An organization's AI message rate limit was exceeded — the message was rejected before any provider call was made."),

  // --- Module 18 — AI Knowledge, Context & Retrieval Infrastructure.
  // Source/document LIFECYCLE and rate-limit denials are audited — real,
  // data-governance-significant events. Individual RETRIEVAL queries are
  // deliberately NOT audited (a real support/AI-assisted workflow could
  // call retrieval many times per minute) — the same "audit the outcome,
  // not every routine action" discipline `ai.conversation.*`'s own
  // comment already establishes for individual chat messages.
  "knowledge.source.created": action("KNOWLEDGE", "A knowledge source was created."),
  "knowledge.source.updated": action("KNOWLEDGE", "A knowledge source's status or classification was changed."),
  "knowledge.source.archived": action("KNOWLEDGE", "A knowledge source was archived."),
  "knowledge.document.ingested": action("KNOWLEDGE", "A document was ingested (a new version became ready)."),
  "knowledge.document.ingestion_failed": action("KNOWLEDGE", "A document ingestion attempt failed (see the version's own failureReason for the safe, sanitized cause)."),
  "knowledge.document.deleted": action("KNOWLEDGE", "A document was deleted (soft-deleted — see knowledge-security.md)."),
  "knowledge.document.reindexed": action("KNOWLEDGE", "A document was re-indexed under a new chunking strategy or embedding model."),
  "knowledge.rate_limit.exceeded": action("KNOWLEDGE", "An organization's knowledge-retrieval rate limit was exceeded — the query was rejected before any retrieval ran."),

  // --- Module 19 (Build 19 / Roadmap 13) — CRM Foundation. This is Alpha
  // Page Rankers' own internal sales tool (see docs/architecture/
  // crm-architecture.md) — every event below concerns the platform's own
  // sales pipeline, never a customer organization's data. Company/contact/
  // lead lifecycle and lead disposition are audited — real business-
  // development-significant events. Individual activity logs (notes,
  // calls, status-change activity records) and task CRUD are deliberately
  // NOT separately audited — CrmActivity is itself the durable record of
  // that history (the same "audit the outcome, not every routine action"
  // discipline `ai.conversation.*` and `knowledge.*` already establish),
  // and CRM tasks are routine day-to-day sales-rep bookkeeping, not a
  // security- or governance-significant event.
  "crm.company.created": action("CRM", "A CRM company was created."),
  "crm.company.archived": action("CRM", "A CRM company was archived."),
  "crm.contact.created": action("CRM", "A CRM contact was created."),
  "crm.contact.archived": action("CRM", "A CRM contact was archived."),
  "crm.lead.created": action("CRM", "A CRM lead was created."),
  "crm.lead.status_changed": action("CRM", "A CRM lead's status changed."),
  "crm.lead.converted": action("CRM", "A CRM lead was converted (marked CONVERTED)."),

  // --- Build 20 (Roadmap Module 14) — Sales Pipeline. Extends the CRM
  // category above rather than adding a new one — same platform-internal
  // sales workspace, same audience. Pipeline/stage configuration and deal
  // lifecycle transitions (creation, ownership change, won/lost/reopened)
  // are audited — real business-significant events with real financial
  // stakes. Routine value/probability/expected-close-date edits and deal
  // notes are deliberately NOT separately audited — `CrmDealHistory` is
  // itself the durable business-chronology record of those (see
  // docs/architecture/sales-pipeline.md "Deal history" for the explicit
  // AuditEvent-vs-DealHistory distinction), the same "audit the outcome,
  // not every routine action" discipline `crm.lead.*` above establishes.
  "crm.pipeline.created": action("CRM", "A sales pipeline was created."),
  "crm.pipeline.archived": action("CRM", "A sales pipeline was archived."),
  "crm.deal.created": action("CRM", "A sales deal was created."),
  "crm.deal.owner_changed": action("CRM", "A sales deal's assigned owner changed."),
  "crm.deal.won": action("CRM", "A sales deal was marked won."),
  "crm.deal.lost": action("CRM", "A sales deal was marked lost."),
  "crm.deal.reopened": action("CRM", "A won or lost sales deal was reopened."),

  // --- Build 21 (Roadmap Module 15) — Sales Team Management. Extends the
  // CRM category above, same audience/reasoning as Build 20's own
  // extension comment. Team membership/manager changes and target/quota
  // creation/archival are audited — real management actions with
  // governance stakes (who is authorized to see whose performance data,
  // what threshold a rep is being held to). Aggregated performance/
  // leaderboard queries are deliberately NOT audited — a read of already-
  // authorized data, not a mutation, the same "audit the outcome, not
  // every read" discipline every prior CRM extension already establishes.
  "crm.sales_team.member_added": action("CRM", "A user was added to the sales team."),
  "crm.sales_team.member_removed": action("CRM", "A user was removed from the sales team."),
  "crm.sales_team.manager_changed": action("CRM", "A sales team member's manager changed."),
  "crm.sales_team.goal_created": action("CRM", "A sales target or quota was created."),
  "crm.sales_team.goal_archived": action("CRM", "A sales target or quota was archived."),

  // --- Build 22 (Roadmap Module 16) — Proposals & Contracts. Extends the
  // CRM category above, same audience/reasoning as Build 20/21's own
  // extension comments. Every real lifecycle transition (creation, send,
  // revision, approval submission/decision, acceptance, rejection,
  // expiry, contract creation/activation/termination/cancellation) is
  // audited — real business/legal-significant events. Line-item edits
  // while still DRAFT are deliberately NOT separately audited — the
  // immutable `CrmProposalVersion` itself, once sent, IS the durable
  // commercial record (the same "audit the outcome, not every draft
  // edit" discipline every prior CRM extension already establishes).
  "crm.proposal.created": action("CRM", "A proposal was created."),
  "crm.proposal.sent": action("CRM", "A proposal was sent."),
  "crm.proposal.revised": action("CRM", "A new proposal version was created (revision)."),
  "crm.proposal.approval_submitted": action("CRM", "A proposal version was submitted for internal approval."),
  "crm.proposal.approved": action("CRM", "A proposal version was approved."),
  "crm.proposal.approval_rejected": action("CRM", "A proposal version's approval request was rejected."),
  "crm.proposal.accepted": action("CRM", "A proposal was accepted by the customer."),
  "crm.proposal.rejected": action("CRM", "A proposal was rejected by the customer."),
  "crm.proposal.expired": action("CRM", "A proposal was marked expired."),
  "crm.contract.created": action("CRM", "A contract was created."),
  "crm.contract.activated": action("CRM", "A contract was activated."),
  "crm.contract.terminated": action("CRM", "A contract was terminated."),
  "crm.contract.cancelled": action("CRM", "A contract was cancelled."),
  // Build 23 (Client Onboarding, Roadmap Module 17). Intake-response and
  // checklist/requirement-item CREATION are deliberately NOT separately
  // audited — the same "audit the outcome, not every draft edit"
  // discipline Build 22's own comment establishes; completion/status
  // transitions are the real business events.
  "crm.onboarding.started": action("CRM", "A client onboarding engagement was started from a deal."),
  "crm.onboarding.organization_linked": action("CRM", "A CRM company was linked to a customer organization (reused an existing one or created a new one) as part of starting onboarding."),
  "crm.onboarding.assigned": action("CRM", "A platform staff member was assigned an onboarding role."),
  "crm.onboarding.requirement_completed": action("CRM", "An onboarding requirement was marked complete."),
  "crm.onboarding.checklist_item_completed": action("CRM", "An onboarding checklist item was marked complete."),
  "crm.onboarding.kickoff_scheduled": action("CRM", "An onboarding kickoff was scheduled."),
  "crm.onboarding.kickoff_completed": action("CRM", "An onboarding kickoff was marked complete."),
  "crm.onboarding.completed": action("CRM", "An onboarding engagement was completed (all required criteria met)."),
  "crm.onboarding.completed_override": action("CRM", "An onboarding engagement was force-completed despite incomplete required work."),
  "crm.onboarding.cancelled": action("CRM", "An onboarding engagement was cancelled."),
  // Build 25 (Client Success, Roadmap Module 19). Computed health/risk
  // READS are deliberately NOT audited (spec's own explicit instruction
  // — see client-success.md "Audit"); only real mutations are.
  "crm.client_success.owner_changed": action("CRM", "The Client Success owner for a customer was set or changed."),
  "crm.client_success.attention_flag_set": action("CRM", "A management-attention flag was set on a customer's Client Success profile."),
  "crm.client_success.attention_flag_cleared": action("CRM", "A management-attention flag was cleared on a customer's Client Success profile."),
  "crm.client_success.renewal_created": action("CRM", "A renewal record was created for a contract."),
  "crm.client_success.renewal_status_changed": action("CRM", "A renewal record's status changed."),
  "crm.client_success.expansion_identified": action("CRM", "A Client Success expansion opportunity was identified."),
  "crm.client_success.expansion_status_changed": action("CRM", "An expansion opportunity's status changed."),
  "crm.client_success.expansion_handed_to_sales": action("CRM", "An expansion opportunity was handed to Sales."),
  "crm.client_success.expansion_dismissed": action("CRM", "An expansion opportunity was dismissed."),
  // Build 27 (Project Management, Roadmap Module 21). Filed under the
  // `CRM` audit CATEGORY (the enum, not the key namespace) — same
  // reasoning Sales Team/Proposals/Onboarding/Client Success already
  // established: Project Management is the next stage of the SAME
  // Alpha-Page-Rankers-internal sales-through-delivery continuum this
  // category already covers, and a sixth narrow `AuditCategory` enum
  // value for one more build would fragment filtering rather than help
  // it (see this file's own comment elsewhere on avoiding enum bloat
  // for a single module's own handful of actions). The action KEY
  // namespace (`projects.*`) still keeps Project Management's own
  // events independently greppable/filterable by key even though the
  // category column groups them with CRM. Only material mutations are
  // audited — never a comment, an ordinary task edit, or a progress
  // read (see project-management.md "Audit").
  "projects.created": action("CRM", "A project was created (manually, from onboarding, or from a template)."),
  "projects.lifecycle_transitioned": action("CRM", "A project's lifecycle status changed."),
  "projects.completed_override": action("CRM", "A project was force-completed despite incomplete required delivery work."),
  "projects.owner_changed": action("CRM", "A project's owner was set or changed."),
  "projects.template_instantiated": action("CRM", "A project was created from a template, snapshotting its milestones/tasks/QA checks."),
  "projects.milestone_changed": action("CRM", "A milestone's title, target date, or customer visibility was materially changed."),
  "projects.task_reopened_after_completion": action("CRM", "A project task was reopened after being marked done."),
  "projects.approval_decided": action("CRM", "A project/milestone approval request was approved or rejected."),
  "projects.qa_decided": action("CRM", "A project QA check was marked passed, failed, or waived."),

  // --- tasks (Build 28 — Roadmap Module 22, Task Management). Reuses
  // the ADMINISTRATION category rather than adding a new `AuditCategory`
  // enum value for this module's own small handful of actions — the
  // same "avoid enum bloat for one module" precedent Build 27 already
  // established for `projects.*` (reusing `CRM`). The action KEY
  // namespace here is `tasks.*`, a single-word namespace distinct from
  // the `task_management.*` PERMISSION namespace — mirroring how
  // `projects.*` audit keys sit next to `delivery_projects.*`
  // permissions; the catalog's own dot-notation convention only allows
  // a single lowercase word before the first dot.
  // Reading/aggregating existing CRM/Project/Onboarding tasks is NEVER
  // separately audited here — those mutations already audit (or
  // deliberately don't, per each source's own established discipline)
  // under their OWN action keys; Task Management only ever audits its
  // own standalone `InternalTask` entity.
  "tasks.internal_task_created": action("ADMINISTRATION", "A standalone internal task was created."),
  "tasks.internal_task_assigned": action("ADMINISTRATION", "A standalone internal task was assigned to a platform staff member."),
  "tasks.internal_task_status_changed": action("ADMINISTRATION", "A standalone internal task's status changed (completed, reopened, or cancelled)."),
  "tasks.internal_task_due_date_changed": action("ADMINISTRATION", "A standalone internal task's due date was materially changed."),

  // --- services (Build 29 — Roadmap Module 23, Service Management).
  // Reuses the CRM category — same precedent `projects.*` already
  // established (Service Management sits in the same commercial/
  // delivery domain family as Project Management, unlike Task
  // Management's own genuinely administrative `InternalTask`). The
  // action KEY namespace here is `services.*`, distinct from the
  // `delivery_services.*` PERMISSION namespace — same single-lowercase-
  // word-before-the-first-dot convention every other action key in this
  // catalog follows.
  "services.definition_created": action("CRM", "A service catalog definition was created."),
  "services.definition_updated": action("CRM", "A service catalog definition's editable fields were changed."),
  "services.definition_archived": action("CRM", "A service catalog definition was archived."),
  "services.definition_reactivated": action("CRM", "An archived service catalog definition was reactivated."),
  "services.customer_service_provisioned": action("CRM", "A customer service engagement was provisioned from an onboarding service item."),
  "services.customer_service_created_manually": action("CRM", "A customer service engagement was created manually, with no proposal/onboarding provenance."),
  "services.customer_service_owner_changed": action("CRM", "A customer service engagement's operational owner was set or changed."),
  "services.customer_service_activated": action("CRM", "A customer service engagement was activated."),
  "services.customer_service_paused": action("CRM", "A customer service engagement was paused."),
  "services.customer_service_resumed": action("CRM", "A paused customer service engagement was resumed."),
  "services.customer_service_completed": action("CRM", "A customer service engagement was marked complete."),
  "services.customer_service_cancelled": action("CRM", "A customer service engagement was cancelled."),
} as const satisfies Record<string, AuditActionDefinition>;

export type AuditActionKey = keyof typeof AUDIT_CATALOG;

export function isAuditActionKey(value: string): value is AuditActionKey {
  // `Object.prototype.hasOwnProperty`, not `value in AUDIT_CATALOG` — `in`
  // also matches inherited `Object.prototype` properties ("toString",
  // "constructor", "hasOwnProperty" itself), which would make this
  // function wrongly return `true` for those strings. Found by this
  // module's own test suite, not by inspection — see
  // `catalog.test.ts`'s "no accidental Object.prototype leak" case. Same
  // safe-lookup pattern `roles.ts`'s `isSystemRoleKey()` already uses.
  return Object.prototype.hasOwnProperty.call(AUDIT_CATALOG, value);
}

export function getAuditActionDefinition(key: AuditActionKey): AuditActionDefinition {
  return AUDIT_CATALOG[key];
}
