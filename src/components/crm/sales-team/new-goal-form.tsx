"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createSalesGoalAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toMinorUnits } from "@/lib/utils/money";
import { PERIOD_NAMES, type PeriodName } from "@/lib/billing/reporting/period";
import { GOAL_METRIC_LABELS } from "@/lib/crm/sales-goal-metric-labels";
import type { CrmSalesGoalKind, CrmSalesGoalMetric } from "@/generated/prisma/client";

const METRICS: CrmSalesGoalMetric[] = ["REVENUE_WON", "DEALS_WON", "CALLS_LOGGED", "APPOINTMENTS_LOGGED", "LEAD_CONVERSION_RATE"];
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const;
const PERIOD_LABELS: Record<PeriodName, string> = {
  today: "Today",
  current_month: "This month",
  previous_month: "Last month",
  current_quarter: "This quarter",
  previous_quarter: "Last quarter",
  current_year: "This year",
  previous_year: "Last year",
};

/** `salesTeamMemberId`, when provided, scopes the new goal to that one rep (the detail page's own entry point); omitted, it creates an organization-wide goal (the overview page's own entry point) — this form deliberately does not offer a member picker of its own. */
export function NewGoalForm({ salesTeamMemberId }: { salesTeamMemberId?: string }) {
  const [kind, setKind] = useState<CrmSalesGoalKind>("TARGET");
  const [metric, setMetric] = useState<CrmSalesGoalMetric>("REVENUE_WON");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState<string>("USD");
  const [period, setPeriod] = useState<PeriodName>("current_month");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!value.trim()) return;
    setError(null);
    startTransition(async () => {
      const payload: Record<string, unknown> = { salesTeamMemberId, kind, metric, period };
      if (metric === "REVENUE_WON") {
        payload.valueMinorUnits = toMinorUnits(Number(value), currency);
        payload.currency = currency;
      } else if (metric === "LEAD_CONVERSION_RATE") {
        payload.valuePercent = Number(value);
      } else {
        payload.valueCount = Number(value);
      }
      const result = await createSalesGoalAction(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      setValue("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-kind">Kind</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as CrmSalesGoalKind)} disabled={pending}>
            <SelectTrigger id="goal-kind" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TARGET">Target</SelectItem>
              <SelectItem value="QUOTA">Quota</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-metric">Metric</Label>
          <Select value={metric} onValueChange={(v) => setMetric(v as CrmSalesGoalMetric)} disabled={pending}>
            <SelectTrigger id="goal-metric" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {METRICS.map((m) => (
                <SelectItem key={m} value={m}>
                  {GOAL_METRIC_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="goal-value">{metric === "LEAD_CONVERSION_RATE" ? "Value (%)" : "Value"}</Label>
          <Input id="goal-value" type="number" min={0} max={metric === "LEAD_CONVERSION_RATE" ? 100 : undefined} step={metric === "REVENUE_WON" ? "0.01" : "1"} value={value} onChange={(e) => setValue(e.target.value)} disabled={pending} />
        </div>
        {metric === "REVENUE_WON" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-currency">Currency</Label>
            <Select value={currency} onValueChange={setCurrency} disabled={pending}>
              <SelectTrigger id="goal-currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="goal-period">Period</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodName)} disabled={pending}>
              <SelectTrigger id="goal-period" className="w-full">
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
          </div>
        )}
      </div>
      {metric === "REVENUE_WON" ? (
        <div className="flex flex-col gap-1.5 sm:w-56">
          <Label htmlFor="goal-period-revenue">Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodName)} disabled={pending}>
            <SelectTrigger id="goal-period-revenue" className="w-full">
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
        </div>
      ) : null}
      <Button onClick={handleSubmit} disabled={pending || !value.trim()} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Create goal
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
