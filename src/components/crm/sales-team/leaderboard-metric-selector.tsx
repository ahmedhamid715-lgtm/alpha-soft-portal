"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LeaderboardMetric } from "@/server/services/crm-sales-performance-service";

const METRIC_LABELS: Record<LeaderboardMetric, string> = {
  REVENUE_WON: "Revenue won",
  DEALS_WON: "Deals won",
  WIN_RATE: "Win rate",
  CALLS_LOGGED: "Calls logged",
  APPOINTMENTS_LOGGED: "Appointments logged",
};

const METRICS: LeaderboardMetric[] = ["REVENUE_WON", "DEALS_WON", "WIN_RATE", "CALLS_LOGGED", "APPOINTMENTS_LOGGED"];

export function LeaderboardMetricSelector({ basePath, metric }: { basePath: string; metric: LeaderboardMetric }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("metric", value);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <Select value={metric} onValueChange={handleChange}>
      <SelectTrigger aria-label="Rank by" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {METRICS.map((m) => (
          <SelectItem key={m} value={m}>
            {METRIC_LABELS[m]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
