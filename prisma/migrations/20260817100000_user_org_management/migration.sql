-- CreateEnum
CREATE TYPE "invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "country" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "logo_url" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "primary_email" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_url" TEXT,
ADD COLUMN     "locale" TEXT,
ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "invitation_status" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_by_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_onboarding" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "current_step" TEXT NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "organization_invitations_organization_id_status_idx" ON "organization_invitations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "organization_invitations_email_idx" ON "organization_invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "organization_onboarding_organization_id_key" ON "organization_onboarding"("organization_id");

-- CreateIndex
-- Hand-added (not Prisma-generated), same pattern as
-- "roles_system_key_key" (Module 05) — at most one PENDING invitation
-- per (organization, email) pair, enforced by the database, not just
-- application-level pre-checks (spec section 15: "do not allow
-- invitation spam"). A partial index (not a plain composite unique
-- constraint) because ACCEPTED/REVOKED rows for the same email must
-- remain freely re-inventable — only PENDING is exclusive.
CREATE UNIQUE INDEX "organization_invitations_pending_email_key" ON "organization_invitations"("organization_id", "email") WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_onboarding" ADD CONSTRAINT "organization_onboarding_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Row-Level Security — Module 07's two new organization-owned tables,
-- following the exact pattern Module 06 established (rls.md) for
-- organization_memberships/roles/role_permissions. Both use the plain
-- org/platform match — neither needs organization_memberships' extra
-- user_id escape hatch: invitation *token* lookup (pre-membership,
-- pre-tenant-context) reads through the plain, non-RLS `db` singleton,
-- the same precedent Module 04's password-reset/email-verification
-- token lookups already established (the token's own secrecy is the
-- authorization, not RLS) — see docs/architecture/invitations.md
-- "Why invitation lookup bypasses RLS, safely." Organization/membership
-- creation during acceptance (and during organization creation itself,
-- spec section 30) sets app.organization_id to the exact org id being
-- written to, which the INSERT policy already satisfies with no special
-- bootstrap bypass needed — the row being inserted IS what defines the
-- context, not a pre-existing membership.

ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON organization_invitations
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON organization_invitations
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON organization_invitations
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON organization_invitations
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

ALTER TABLE organization_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_onboarding FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_select ON organization_onboarding
  FOR SELECT
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_insert ON organization_onboarding
  FOR INSERT
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_update ON organization_onboarding
  FOR UPDATE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context())
  WITH CHECK (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());

CREATE POLICY tenant_isolation_delete ON organization_onboarding
  FOR DELETE
  USING (organization_id = tenant_current_organization_id() OR tenant_is_platform_context());
