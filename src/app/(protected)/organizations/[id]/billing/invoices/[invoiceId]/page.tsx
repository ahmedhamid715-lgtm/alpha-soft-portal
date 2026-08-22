import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolveOrganizationContext } from "@/lib/authorization/context";
import { getInvoiceForOrganization } from "@/server/services/invoice-service";
import { NotFoundError } from "@/lib/errors/app-error";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = { title: "Invoice" };

const INVOICE_STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "neutral"> = {
  PAID: "success",
  OPEN: "warning",
  DRAFT: "neutral",
  VOID: "neutral",
  UNCOLLECTIBLE: "destructive",
};

/** One invoice's detail — immutable line items exactly as billed (spec §11), never recalculated from today's plan pricing. */
export default async function InvoiceDetailPage({ params }: PageProps<"/organizations/[id]/billing/invoices/[invoiceId]">) {
  const { id, invoiceId } = await params;
  const context = await resolveOrganizationContext(id);

  if (!context.organizationId || context.organizationId !== id) notFound();

  if (!context.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invoice" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Billing", href: `/organizations/${id}/billing` }, { label: "Invoices", href: `/organizations/${id}/billing/invoices` }, { label: "Invoice" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing invoices requires the billing.read permission." />
      </div>
    );
  }

  let invoice;
  try {
    invoice = await getInvoiceForOrganization({ organizationId: id, invoiceId });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={invoice.invoiceNumber}
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "Billing", href: `/organizations/${id}/billing` }, { label: "Invoices", href: `/organizations/${id}/billing/invoices` }, { label: invoice.invoiceNumber }]}
        actions={
          invoice.hostedInvoiceUrl ? (
            <Button asChild variant="outline" size="sm">
              <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                View hosted invoice <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Status</span>
            <StatusBadge status={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{invoice.status}</StatusBadge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Issued</span>
            <span className="font-medium">{new Date(invoice.issueDate).toLocaleDateString()}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-medium tabular-nums">{formatMoney(invoice.total, invoice.currency)}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">Amount due</span>
            <span className="font-medium tabular-nums">{formatMoney(invoice.amountDue, invoice.currency)}</span>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Line items" />
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lineItems.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.unitAmount, invoice.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.taxAmount, invoice.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(line.total, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="ml-auto flex w-full max-w-xs flex-col gap-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{formatMoney(invoice.subtotal, invoice.currency)}</span></div>
          {invoice.discountTotal > 0 ? <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">-{formatMoney(invoice.discountTotal, invoice.currency)}</span></div> : null}
          <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="tabular-nums">{formatMoney(invoice.taxTotal, invoice.currency)}</span></div>
          <div className="flex justify-between border-t border-border pt-1 font-medium"><span>Total</span><span className="tabular-nums">{formatMoney(invoice.total, invoice.currency)}</span></div>
        </div>
      </section>
    </div>
  );
}
