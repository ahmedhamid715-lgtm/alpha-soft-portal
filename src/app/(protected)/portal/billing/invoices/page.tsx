import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
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

export default async function PortalInvoicesPage({ searchParams }: PageProps<"/portal/billing/invoices">) {
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Invoices" />;

  if (!guard.authorization.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invoices" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing", href: "/portal/billing" }, { label: "Invoices" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing invoices requires the billing.read permission." />
      </div>
    );
  }

  const sp = await searchParams;
  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const cursor = single(sp.cursor);

  const page = await listInvoicesForOrganization({ organizationId: guard.organizationId, cursor, limit: 25 });
  const basePath = "/portal/billing/invoices";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing", href: "/portal/billing" }, { label: "Invoices" }]} />

      {page.items.length === 0 ? (
        <EmptyState title="No invoices yet" />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.items.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <Link href={`/portal/billing/invoices/${invoice.id}`} className="hover:underline">
                      {invoice.invoiceNumber}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{invoice.status}</StatusBadge>
                  </TableCell>
                  <TableCell>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-right">{formatMoney(invoice.total, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {page.pageInfo.hasNextPage && page.pageInfo.nextCursor ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`${basePath}?cursor=${page.pageInfo.nextCursor}`}>Next page</Link>
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
