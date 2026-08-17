-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('UNREAD', 'READ', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "notification_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "notification_delivery_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "notification_severity" NOT NULL DEFAULT 'INFO',
    "status" "notification_status" NOT NULL DEFAULT 'UNREAD',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" TEXT,
    "metadata" JSONB,
    "source_event_type" TEXT NOT NULL,
    "source_entity_type" TEXT,
    "source_entity_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "organization_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "notification_delivery_status" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "provider_message_id" TEXT,
    "failure_code" TEXT,
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_status_idx" ON "notifications"("recipient_user_id", "status");

-- CreateIndex
CREATE INDEX "notifications_organization_id_created_at_idx" ON "notifications"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_source_event_type_source_entity_id_idx" ON "notifications"("source_event_type", "source_entity_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_notification_id_idx" ON "notification_deliveries"("notification_id");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_organization_id_created_at_idx" ON "notification_deliveries"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_category_channel_key" ON "notification_preferences"("user_id", "category", "channel");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Row-Level Security — Module 09 (spec sections 19/38). Uses the SAME
-- context functions Module 06 established (tenant_current_user_id(),
-- tenant_current_organization_id(), tenant_is_platform_context() —
-- migration 20260817090000_row_level_security), evaluated by the
-- restricted alpha_os_app role. See docs/architecture/notifications.md
-- for why `notifications`' policies are keyed on the RECIPIENT, not the
-- organization — a structurally different shape than every previous
-- RLS-protected table in this codebase, not a mechanical copy-paste of
-- the organization-membership pattern.
--
-- `notification_preferences` deliberately has NO RLS at all — same
-- category as `users`/`user_credentials`/`user_sessions` in rls.md's
-- own "Tables deliberately without RLS": global identity data, not
-- tenant-owned. Protected by an ordinary service-layer ownership check
-- (`preference.userId === session.user.id`), the same way
-- `updateOwnProfile()` already protects `User` fields.
-- =============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

-- The recipient always sees their own notifications, regardless of
-- organization context; platform context sees everything (observability
-- — the application layer narrows this further, same "two independent
-- layers" reasoning audit-security.md documents for the audit log).
CREATE POLICY recipient_isolation_select ON notifications
  FOR SELECT
  USING (recipient_user_id = tenant_current_user_id() OR tenant_is_platform_context());

-- INSERT is governed by the CREATING transaction's own tenant context
-- (the notification service/event subscriber runs inside
-- withTenantContext() scoped to the source event's organization) — same
-- organization_id IS NULL allowance AuditEvent's own INSERT policy
-- needs, for the identical reason (a pre-tenant/global notification, or
-- a handler running with no established org context yet). Never
-- client-supplied — organizationId always comes from the server-resolved
-- event, never request input.
CREATE POLICY tenant_isolation_insert ON notifications
  FOR INSERT
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    OR organization_id IS NULL
    OR tenant_is_platform_context()
  );

-- Only the recipient may mutate their own notification's lifecycle
-- (mark read/unread/archived) — deliberately NARROWER than SELECT (no
-- platform-context override here; observability does not need to
-- mutate a customer's own read state).
CREATE POLICY recipient_isolation_update ON notifications
  FOR UPDATE
  USING (recipient_user_id = tenant_current_user_id())
  WITH CHECK (recipient_user_id = tenant_current_user_id());

-- No DELETE policy at all — notifications are archived, never deleted,
-- by the application (see notification-security.md "Retention"). With
-- FORCE ROW LEVEL SECURITY, zero matching policies means zero rows
-- match a DELETE unconditionally — the same append-mostly guarantee
-- Module 08 established for audit_events, applied here to the subset of
-- operations (deletion) this table also never performs.

ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY;

-- Platform-context-only — no regular-user/organization SELECT path
-- exists at all. A customer never queries delivery internals directly;
-- they see their own `Notification` row. The future delivery/retry
-- processor (lib/notifications/delivery.ts) runs under platform tenant
-- context (isPlatformStaff: true), the same "acting as the system" shape
-- already used elsewhere in this codebase.
CREATE POLICY platform_only_select ON notification_deliveries
  FOR SELECT
  USING (tenant_is_platform_context());

-- Same organization_id IS NULL allowance as `notifications` above — the
-- delivery service creates this row inside the SAME transaction/tenant
-- context as its parent Notification.
CREATE POLICY tenant_isolation_insert ON notification_deliveries
  FOR INSERT
  WITH CHECK (
    organization_id = tenant_current_organization_id()
    OR organization_id IS NULL
    OR tenant_is_platform_context()
  );

-- Only the delivery/retry processor (platform tenant context) updates a
-- delivery record's status/attemptCount/etc. — no regular-user update
-- path.
CREATE POLICY platform_only_update ON notification_deliveries
  FOR UPDATE
  USING (tenant_is_platform_context())
  WITH CHECK (tenant_is_platform_context());

-- No DELETE policy — same reasoning as `notifications`.

-- =============================================================================
-- Restricted-role privilege restriction — neither table's application
-- code ever deletes a row (see server/repositories/notification-*.ts);
-- REVOKE DELETE at the grant layer is belt-and-suspenders on top of the
-- "no DELETE policy" guarantee above, same discipline Module 08 applied
-- to audit_events. UPDATE is intentionally NOT revoked here (unlike
-- audit_events) — marking a notification read/archived, and the
-- delivery processor updating attempt state, are real, legitimate
-- application operations these tables must support.
--
-- Guarded by existence check — see the identical comment in
-- 20260818090000_audit_system's migration for why.
-- =============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alpha_os_app') THEN
    REVOKE DELETE ON notifications FROM alpha_os_app;
    REVOKE DELETE ON notification_deliveries FROM alpha_os_app;
  END IF;
END $$;
