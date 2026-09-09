import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { guardPortalPage } from "@/lib/portal/guard";
import { PortalGateState } from "@/components/portal/portal-gate";
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

/**
 * One invoice's detail — `invoiceId` is a client-supplied route param,
 * never trusted directly: `getInvoiceForOrganization()` independently
 * verifies it belongs to THIS organization (`invoice.organizationId !==
 * organizationId` → `NotFoundError`, the same real IDOR protection
 * `/organizations/[id]/billing/invoices/[invoiceId]` already relies on).
 */
export default async function PortalInvoiceDetailPage({ params }: PageProps<"/portal/billing/invoices/[invoiceId]">) {
  const { invoiceId } = await params;
  const guard = await guardPortalPage();
  if (guard.kind !== "ready") return <PortalGateState guard={guard} title="Invoice" />;

  if (!guard.authorization.permissions.has("billing.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Invoice" breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing", href: "/portal/billing" }, { label: "Invoices", href: "/portal/billing/invoices" }, { label: "Invoice" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing invoices requires the billing.read permission." />
      </div>
    );
  }

  let invoice;
  try {
    invoice = await getInvoiceForOrganization({ organizationId: guard.organizationId, invoiceId });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Billing", href: "/portal/billing" }, { label: "Invoices", href: "/portal/billing/invoices" }, { label: invoice.invoiceNumber }]}
      />

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <StatusBadge status={INVOICE_STATUS_TONE[invoice.status] ?? "neutral"}>{invoice.status}</StatusBadge>
            <span className="text-sm text-muted-foreground">{invoice.dueDate ? `Due ${new Date(invoice.dueDate).toLocaleDateString()}` : "No due date"}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="font-medium">{formatMoney(invoice.total, invoice.currency)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Amount due</span>
            <span className="font-medium">{formatMoney(invoice.amountDue, invoice.currency)}</span>
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Line items" />
        {invoice.lineItems.length === 0 ? (
          <EmptyState title="No line items" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>{li.description}</TableCell>
                  <TableCell className="text-right">{formatMoney(li.total, invoice.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
