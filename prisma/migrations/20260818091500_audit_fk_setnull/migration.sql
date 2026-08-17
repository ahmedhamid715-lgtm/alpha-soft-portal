-- DropForeignKey
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_user_id_fkey";

-- DropForeignKey
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_organization_id_fkey";

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
