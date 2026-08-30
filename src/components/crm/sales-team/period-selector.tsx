"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PERIOD_NAMES, type PeriodName } from "@/lib/billing/reporting/period";

const PERIOD_LABELS: Record<PeriodName, string> = {
  today: "Today",
  current_month: "This month",
  previous_month: "Last month",
  current_quarter: "This quarter",
  previous_quarter: "Last quarter",
  current_year: "This year",
  previous_year: "Last year",
};

/** Query-param-driven period selector (`?period=`), preserving any other existing query params (e.g. `?metric=`) — mirrors `PipelineSelector`'s own pattern, extended to merge rather than replace the whole query string. Only named periods (no custom-range UI yet — a real, deliberate V1 scope limit; `getSalesPerformanceSummary()`/`getSalesLeaderboard()` both already accept an explicit `periodStart`/`periodEnd` for a future custom-range control). */
export function PeriodSelector({ basePath, period }: { basePath: string; period: PeriodName }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("period", value);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <Select value={period} onValueChange={handleChange}>
      <SelectTrigger aria-label="Period" className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERIOD_NAMES.map((name) => (
          <SelectItem key={name} value={name}>
            {PERIOD_LABELS[name]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
