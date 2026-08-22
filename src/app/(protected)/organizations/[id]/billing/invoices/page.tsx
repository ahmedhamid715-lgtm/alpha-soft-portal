import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { listInvoicesForOrganization } from "@/server/services/invoice-service";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Invoices" };

const INVOICE_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = {
  PAID: "success",
  OPEN: "warning",
  DRAFT: "neutral",
  VOID: "neutral",
  UNCOLLECTIBLE: "destructive",
};

/**
 * Invoice history — `billing.read`, cursor-paginated (spec §41, never
 * offset: an organization's invoice count grows unbounded over its
 * lifetime).
 */
export default async function InvoicesPage({ params, searchParams }: PageProps<"/organizations/[id]/billing/invoices">) {
  const { id } = await params;
  const sp = await searchParams;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) notFound();

  if (!context.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invoices" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Billing", href: `/organizations/${id}/billing` }, { label: "Invoices" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing invoices requires the billing.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);

  const page = await listInvoicesForOrganization({ organizationId: id, cursor, limit: 25 });
  const basePath = `/organizations/${id}/billing/invoices`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Billing", href: `/organizations/${id}/billing` }, { label: "Invoices" }]}
      />

      {page.items.length === 0 ? (
        <EmptyState title="No invoices yet" description="Invoices appear here once your first billing cycle completes." />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link href={`${basePath}/${invoice.id}`} className="font-medium text-link hover:underline">
                      {invoice.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{new Date(invoice.issueDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <StatusBadge status={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{invoice.status}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(invoice.total, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {page.pageInfo.hasNextPage ? (
        <Button asChild variant="outline" className="w-fit">
          <Link href={`${basePath}?cursor=${page.pageInfo.nextCursor}`}>Next page</Link>
        </Button>
      ) : null}
    </div>
  );
}
