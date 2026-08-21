-- CreateTable
CREATE TABLE "organization_invitation_policies" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "require_owner_for_invitations" BOOLEAN NOT NULL DEFAULT false,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "invitation_expiry_hours" INTEGER NOT NULL DEFAULT 168,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_invitation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitation_policies_organization_id_key" ON "organization_invitation_policies"("organization_id");

-- AddForeignKey
ALTER TABLE "organization_invitation_policies" ADD CONSTRAINT "organization_invitation_policies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
