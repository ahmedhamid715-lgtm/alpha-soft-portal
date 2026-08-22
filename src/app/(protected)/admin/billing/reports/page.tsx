import type { Metadata } from "next";
import { ShieldAlert, Download } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";

export const metadata: Metadata = { title: "Billing reports" };

const REPORTS = [
  { type: "invoices", label: "Invoices", description: "Every invoice — number, status, currency, subtotal, total, amount paid/due, dates." },
  { type: "payments", label: "Payments", description: "Every payment — status, currency, amount, safe payment-method display fields, dates." },
  { type: "refunds", label: "Refunds", description: "Every refund — the payment it applies to, status, currency, amount, reason." },
  { type: "credits", label: "Credit ledger", description: "Every credit ledger entry — type, currency, amount, reason, the compensating entry it corrects (if any)." },
  { type: "aging", label: "AR aging", description: "Outstanding receivables by aging bucket and currency, as of now." },
  { type: "mrr", label: "MRR / ARR", description: "Current MRR and ARR by currency, with subscription counts." },
] as const;

/**
 * Billing report exports (spec §12) — `billing.reports.export`. Every
 * download is a real, cursor-batched, streamed CSV
 * (`billing-export-service.ts`) — nothing here loads a full dataset
 * into server memory, and every export is independently audited
 * (`billing.report.exported`).
 */
export default async function AdminBillingReportsPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.reports.export")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Billing reports" breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Reports" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Exporting billing reports requires the billing.reports.export permission." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Billing reports"
        description="Platform-wide CSV exports. Every export is audited and streamed — safe for a large dataset."
        breadcrumbs={[{ label: "Billing", href: "/admin/billing" }, { label: "Reports" }]}
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Available reports" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {REPORTS.map((report) => (
            <Card key={report.type}>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <p className="font-medium">{report.label}</p>
                  <p className="text-sm text-muted-foreground">{report.description}</p>
                </div>
                <Button asChild variant="outline" className="w-fit">
                  <a href={`/admin/billing/export/${report.type}`}>
                    <Download className="size-4" aria-hidden="true" />
                    Download CSV
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
