-- CreateEnum
CREATE TYPE "ai_conversation_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ai_message_role" AS ENUM ('USER', 'ASSISTANT');

-- AlterEnum
ALTER TYPE "audit_category" ADD VALUE 'AI';

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "ai_conversation_status" NOT NULL DEFAULT 'OPEN',
    "title" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "ai_message_role" NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_minor_units" INTEGER,
    "latency_ms" INTEGER,
    "provider_message_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_conversations_organization_id_updated_at_idx" ON "ai_conversations"("organization_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "ai_messages_conversation_id_created_at_idx" ON "ai_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-Level Security (Module 17) — ai_conversations is directly
-- organization-owned (same shape as subscriptions/invoices:
-- 20260821162000_billing_rls/migration.sql), standard tenant-isolation
-- policy for all four operations. ai_messages is TRANSITIVELY
-- organization-owned via conversation_id -> organization_id, the exact
-- one-hop EXISTS pattern invoice_line_items already uses
-- (20260821162000_billing_rls/migration.sql) — immutable, no UPDATE/
-- DELETE policy (a chat transcript is never revised after the fact,
-- same discipline as invoice_line_items/audit_events). FORCE ROW LEVEL
-- SECURITY throughout, same as every other RLS-protected table in this
-- codebase.

ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON ai_conversations
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON ai_conversations
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON ai_conversations
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

-- No DELETE policy — a conversation is closed (status = CLOSED), never
-- deleted, the same "archive, don't destroy" discipline this codebase
-- applies to Organization/User/Subscription. Unconditionally filtered
-- to zero rows for every role.

ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON ai_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_messages.conversation_id
        AND (c.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

CREATE POLICY tenant_isolation_insert ON ai_messages
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ai_conversations c
      WHERE c.id = ai_messages.conversation_id
        AND (c.organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
    )
  );

-- No UPDATE/DELETE policy — immutable, append-only (see this table's
-- own doc comment in schema.prisma).
