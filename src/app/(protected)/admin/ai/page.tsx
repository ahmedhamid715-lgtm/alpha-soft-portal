import type { Metadata } from "next";
import { ShieldAlert, MessageCircle, Coins } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MetricCard } from "@/components/shared/metric-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { getPlatformAiUsageSummary } from "@/server/services/ai-observability-service";
import { formatMoney } from "@/lib/utils/money";

export const metadata: Metadata = { title: "AI usage" };

/**
 * Platform AI usage/cost observability (Module 17) — `ai.observability`.
 * Operational metadata only (message counts, token counts, ESTIMATED
 * cost) — never any organization's actual conversation content, the
 * same boundary `/admin/notifications` already establishes for delivery
 * observability vs. notification content.
 */
export default async function AdminAiUsagePage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("ai.observability")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="AI usage" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Viewing AI usage requires the ai.observability permission." />
      </div>
    );
  }

  const summary = await getPlatformAiUsageSummary({ period: "current_month" });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="AI usage"
        description="Platform-wide AI message/token/cost activity, this month. Cost is an ESTIMATE from a locally-maintained pricing table, not a verified provider invoice figure — see docs/architecture/ai-infrastructure.md."
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="This month" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <MetricCard label="Messages" value={String(summary.totals.messageCount)} icon={MessageCircle} />
          <MetricCard label="Input tokens" value={summary.totals.inputTokens.toLocaleString()} />
          <MetricCard label="Output tokens" value={summary.totals.outputTokens.toLocaleString()} />
          <MetricCard label="Estimated cost (USD)" value={formatMoney(summary.totals.costMinorUnits, "USD")} icon={Coins} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="By organization" description="Organizations with at least one AI message this month, highest estimated cost first." />
        {summary.byOrganization.length === 0 ? (
          <EmptyState title="No AI activity this month" />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organization</TableHead>
                  <TableHead className="text-right">Messages</TableHead>
                  <TableHead className="text-right">Input tokens</TableHead>
                  <TableHead className="text-right">Output tokens</TableHead>
                  <TableHead className="text-right">Estimated cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byOrganization.map((row) => (
                  <TableRow key={row.organizationId}>
                    <TableCell className="font-medium">{row.organizationName}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.messageCount}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.inputTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.outputTokens.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(row.costMinorUnits, "USD")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
