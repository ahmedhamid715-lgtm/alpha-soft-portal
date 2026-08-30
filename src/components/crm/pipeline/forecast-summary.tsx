import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import type { CrmForecastSummary } from "@/server/services/crm-deal-forecast-service";

function CurrencyLines({ totals, emptyLabel }: { totals: { currency: string; totalMinorUnits: number }[]; emptyLabel: string }) {
  if (totals.length === 0) return <span className="text-lg font-semibold tabular-nums text-muted-foreground">{emptyLabel}</span>;
  return (
    <div className="flex flex-col">
      {totals.map((t) => (
        <span key={t.currency} className="text-lg font-semibold tabular-nums">
          {formatMoney(t.totalMinorUnits, t.currency)}
        </span>
      ))}
    </div>
  );
}

/** Deterministic forecast math only — see `crm-deal-forecast-service.ts`'s own top comment. Amounts are shown per-currency (never summed across currencies); excluded-deal counts are surfaced honestly rather than hidden. */
export function ForecastSummary({ summary }: { summary: CrmForecastSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Pipeline value</span>
          <CurrencyLines totals={summary.pipelineValue} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">All open deals</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Weighted forecast</span>
          <CurrencyLines totals={summary.weightedForecast} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">
            Value × probability
            {summary.weightedForecastExcludedCount > 0 ? ` — ${summary.weightedForecastExcludedCount} deal${summary.weightedForecastExcludedCount === 1 ? "" : "s"} without a probability excluded` : ""}
          </span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Expected closing</span>
          <CurrencyLines totals={summary.expectedClosing} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">
            {formatInTimeZone(summary.expectedClosingWindow.from, "UTC", { month: "short", day: "numeric" })} – {formatInTimeZone(summary.expectedClosingWindow.to, "UTC", { month: "short", day: "numeric" })}
            {summary.expectedClosingExcludedCount > 0 ? ` — ${summary.expectedClosingExcludedCount} without a close date excluded` : ""}
          </span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Won this period</span>
          <CurrencyLines totals={summary.wonValue} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">
            {formatInTimeZone(summary.wonWindow.from, "UTC", { month: "short", day: "numeric" })} – {formatInTimeZone(summary.wonWindow.to, "UTC", { month: "short", day: "numeric" })}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
