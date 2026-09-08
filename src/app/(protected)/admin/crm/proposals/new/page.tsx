import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getDealWithRelations } from "@/server/services/crm-deal-service";
import { listContactsForCompany } from "@/server/services/crm-contact-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { listProposalTemplates } from "@/server/services/crm-proposal-template-service";
import { toAppError } from "@/lib/errors/app-error";
import { ProposalCreateForm } from "@/components/crm/proposals/proposal-create-form";

export const metadata: Metadata = { title: "New Proposal" };

/**
 * A proposal ALWAYS originates from a deal — this page requires
 * `?dealId=` (linked from the deal detail page's own "New proposal"
 * button; see the master prompt's own "do not create a duplicate
 * opportunity" instruction). No standalone-proposal creation path
 * exists, deliberately.
 */
export default async function NewProposalPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dealId = Array.isArray(sp.dealId) ? sp.dealId[0] : sp.dealId;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.proposal.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New Proposal" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.proposal.manage permission." />
      </div>
    );
  }

  if (!dealId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="New Proposal" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: "New" }]} />
        <EmptyState title="Start from a deal" description="A proposal always originates from an existing Sales Pipeline deal — open a deal and use its own “New proposal” button." action={<Link href="/admin/crm/pipeline" className="text-sm text-primary hover:underline">Go to the Sales Pipeline</Link>} />
      </div>
    );
  }

  let deal;
  try {
    deal = await getDealWithRelations({ dealId });
  } catch (error) {
    if (toAppError(error).code === "NOT_FOUND") notFound();
    throw error;
  }

  const [contacts, users, templates] = await Promise.all([listContactsForCompany({ companyId: deal.companyId }), listAssignableUsers(), listProposalTemplates({ status: "ACTIVE" })]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="New Proposal"
        description={`For ${deal.title} — ${deal.company.name}.`}
        breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Proposals", href: "/admin/crm/proposals" }, { label: "New" }]}
      />
      <Card>
        <CardContent>
          <ProposalCreateForm dealId={deal.id} contacts={contacts} templates={templates} users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
