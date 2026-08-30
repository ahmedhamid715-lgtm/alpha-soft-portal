import { Card, CardContent } from "@/components/ui/card";
import { formatMoney } from "@/lib/utils/money";
import type { RepPerformanceRow } from "@/server/services/crm-sales-performance-service";

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

/** A rep's real performance numbers for one period — every ratio is `null` ("Not measurable"), never a fabricated `0%`, when its own denominator is zero. Mirrors `ForecastSummary`'s own card layout/conventions. */
export function PerformanceCards({ row }: { row: RepPerformanceRow }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Won this period</span>
          <CurrencyLines totals={row.wonValueByCurrency} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">{row.wonDealCount} deal{row.wonDealCount === 1 ? "" : "s"} won</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Win rate</span>
          <span className="text-lg font-semibold tabular-nums">{row.winRatePercent === null ? "Not measurable" : `${row.winRatePercent}%`}</span>
          <span className="text-xs text-muted-foreground">{row.wonDealCount + row.lostDealCount} deals closed this period</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Calls / appointments</span>
          <span className="text-lg font-semibold tabular-nums">
            {row.callsLogged} / {row.appointmentsLogged}
          </span>
          <span className="text-xs text-muted-foreground">Logged this period</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Lead conversion</span>
          <span className="text-lg font-semibold tabular-nums">{row.leadConversion.ratePercent === null ? "Not measurable" : `${row.leadConversion.ratePercent}%`}</span>
          <span className="text-xs text-muted-foreground">
            {row.leadConversion.convertedCount} of {row.leadConversion.createdCount} leads (cohort, as of now)
          </span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Open pipeline</span>
          <CurrencyLines totals={row.openPipelineValueByCurrency} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">Current, live — not period-scoped</span>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Weighted pipeline</span>
          <CurrencyLines totals={row.weightedPipelineByCurrency} emptyLabel="$0" />
          <span className="text-xs text-muted-foreground">Value × probability, current</span>
        </CardContent>
      </Card>
    </div>
  );
}
