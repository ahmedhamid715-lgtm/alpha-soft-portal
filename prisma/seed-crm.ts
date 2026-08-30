/**
 * Build 19 (Roadmap Module 13 — CRM Foundation) dev fixtures — a
 * small, realistic slice of Alpha Page Rankers' own internal sales
 * pipeline: lead sources, companies, contacts, leads across every
 * status, one logged activity, and one open follow-up task. Every row
 * belongs to the ONE platform organization (`alpha-os-platform`, seeded
 * by `seed-rbac.ts`'s `seedAuthorizationFixtures()`) — never a customer
 * organization — see `docs/architecture/crm-architecture.md`
 * "Organization vs CRM Company."
 *
 * Deliberately uses the REPOSITORY layer directly, never the
 * `crm-*-service.ts` layer — same reasoning `seed-billing.ts`'s own top
 * comment documents: the service layer transitively imports
 * `requirePermission()` -> `session-guard` -> next-auth's own module
 * graph, which doesn't work inside this bare `tsx` process. RLS is not a
 * concern here either way — this script runs on the same superuser DB
 * connection every other seed file uses, which bypasses RLS entirely
 * (including FORCE ROW LEVEL SECURITY, which only forces RLS onto the
 * table owner, never a true Postgres superuser).
 *
 * Idempotent: guarded by a single find-or-skip check on the first lead
 * source (`"Referral"`), the same "one guard for the whole fixture set"
 * pattern `prisma/seed.ts`'s own dev-organization check uses.
 */
import { generateId } from "../src/lib/utils/id";
import { organizationRepository } from "../src/server/repositories/organization-repository";
import { userRepository } from "../src/server/repositories/user-repository";
import { crmCompanyRepository } from "../src/server/repositories/crm-company-repository";
import { crmContactRepository } from "../src/server/repositories/crm-contact-repository";
import { crmLeadSourceRepository } from "../src/server/repositories/crm-lead-source-repository";
import { crmLeadRepository } from "../src/server/repositories/crm-lead-repository";
import { crmActivityRepository } from "../src/server/repositories/crm-activity-repository";
import { crmTaskRepository } from "../src/server/repositories/crm-task-repository";

export async function seedCrmFixtures(): Promise<void> {
  const platformOrg = await organizationRepository.findBySlug("alpha-os-platform");
  if (!platformOrg) {
    console.log("[seed-crm] Platform organization not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const existingSource = (await crmLeadSourceRepository.listForOrganization(platformOrg.id)).find((s) => s.name === "Referral");
  if (existingSource) {
    console.log("[seed-crm] CRM fixtures already exist — nothing to do.");
    return;
  }

  const platformOwner = await userRepository.findByEmail("platform-owner@alpha-os.test");
  const platformAdmin = await userRepository.findByEmail("platform-admin@alpha-os.test");
  if (!platformOwner || !platformAdmin) {
    console.log("[seed-crm] Platform dev accounts not found — run seedAuthorizationFixtures() first. Skipping.");
    return;
  }

  const referral = await crmLeadSourceRepository.create({ id: generateId(), organizationId: platformOrg.id, name: "Referral" });
  await crmLeadSourceRepository.create({ id: generateId(), organizationId: platformOrg.id, name: "Outbound" });
  await crmLeadSourceRepository.create({ id: generateId(), organizationId: platformOrg.id, name: "Website" });

  const acme = await crmCompanyRepository.create({ id: generateId(), organizationId: platformOrg.id, name: "Acme Retail Group", domain: "acmeretail.example", industry: "Retail", website: "https://acmeretail.example", phone: null });
  const globex = await crmCompanyRepository.create({ id: generateId(), organizationId: platformOrg.id, name: "Globex Logistics", domain: "globexlogistics.example", industry: "Logistics", website: null, phone: "+1-555-0139" });

  const acmeContact = await crmContactRepository.create({ id: generateId(), organizationId: platformOrg.id, companyId: acme.id, firstName: "Jordan", lastName: "Reyes", email: "jordan.reyes@acmeretail.example", phone: null, jobTitle: "Marketing Director" });
  await crmContactRepository.create({ id: generateId(), organizationId: platformOrg.id, companyId: globex.id, firstName: "Priya", lastName: "Nair", email: "priya.nair@globexlogistics.example", phone: null, jobTitle: "Operations Lead" });

  const qualifiedLead = await crmLeadRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    companyId: acme.id,
    primaryContactId: acmeContact.id,
    sourceId: referral.id,
    title: "SEO audit + local landing pages — Acme Retail Group",
    description: "Referred by an existing client. Interested in a full SEO audit ahead of a Q2 regional expansion.",
    assignedToUserId: platformAdmin.id,
  });
  await crmLeadRepository.changeStatus(qualifiedLead.id, "QUALIFIED", "NEW");

  await crmLeadRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    companyId: globex.id,
    primaryContactId: null,
    sourceId: null,
    title: "Technical SEO retainer — Globex Logistics",
    description: null,
    assignedToUserId: null,
  });

  await crmActivityRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    leadId: qualifiedLead.id,
    companyId: null,
    contactId: null,
    type: "CALL",
    body: "Discovery call — confirmed budget and timeline for the Q2 expansion.",
    callDurationSeconds: 1320,
    callOutcome: "CONNECTED",
    actorUserId: platformAdmin.id,
  });

  await crmTaskRepository.create({
    id: generateId(),
    organizationId: platformOrg.id,
    leadId: qualifiedLead.id,
    companyId: null,
    contactId: null,
    title: "Send SEO audit proposal",
    description: "Follow up with the proposal document discussed on the discovery call.",
    dueAt: null,
    assignedToUserId: platformAdmin.id,
    createdByUserId: platformOwner.id,
  });

  console.log(`[seed-crm] CRM fixtures seeded for platform organization (${platformOrg.id}): 3 lead sources, 2 companies, 2 contacts, 2 leads, 1 activity, 1 task.`);
}
