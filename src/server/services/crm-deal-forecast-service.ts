import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope } from "./crm-shared";
import { crmDealRepository, type CurrencyTotal } from "@/server/repositories/crm-deal-repository";

/**
 * Sales forecasting (Build 20 — Roadmap Module 14) — `crm.pipeline.read`.
 * Deterministic, honest arithmetic only — see sales-pipeline.md
 * "Forecasting": no predictive modeling, nothing calls itself "AI
 * forecasting." Every amount is grouped by currency, never fake-
 * converted to one blended number (`src/lib/utils/money.ts`'s own
 * `CurrencyMismatchError` exists for exactly this reason) — a caller
 * with genuinely single-currency data will just see a one-element
 * array. Every aggregate runs as a real SQL SUM/GROUP BY in
 * `crmDealRepository` (`groupBy()`/`$queryRaw`), never a full deal list
 * pulled into JavaScript to sum by hand.
 */
export interface CrmForecastSummary {
  pipelineValue: CurrencyTotal[];
  weightedForecast: CurrencyTotal[];
  /** OPEN deals excluded from `weightedForecast` because they have no `probability` set — never silently assumed 0% or 100%. */
  weightedForecastExcludedCount: number;
  expectedClosing: CurrencyTotal[];
  expectedClosingWindow: { from: Date; to: Date };
  /** OPEN deals excluded from `expectedClosing` because they have no `expectedCloseDate` set. */
  expectedClosingExcludedCount: number;
  wonValue: CurrencyTotal[];
  wonWindow: { from: Date; to: Date };
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

const forecastSummarySchema = z.object({
  pipelineId: z.string().uuid().optional(),
  closingFrom: z.coerce.date().optional(),
  closingTo: z.coerce.date().optional(),
  wonFrom: z.coerce.date().optional(),
  wonTo: z.coerce.date().optional(),
});

/** Defaults both windows to the current calendar month (UTC) when not given — a reasonable, honest default for a dashboard summary, never silently expanded to "all time" (which would make "expected closing" meaningless). */
export async function getForecastSummary(rawInput: unknown = {}): Promise<CrmForecastSummary> {
  const input = parseOrThrow(forecastSummarySchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.pipeline.read");

  const now = new Date();
  const closingFrom = input.closingFrom ?? startOfMonth(now);
  const closingTo = input.closingTo ?? startOfNextMonth(now);
  const wonFrom = input.wonFrom ?? startOfMonth(now);
  const wonTo = input.wonTo ?? startOfNextMonth(now);

  return withTenantContext(tenantScope, async (tx) => {
    const [pipelineValue, weightedForecast, weightedForecastExcludedCount, expectedClosing, expectedClosingExcludedCount, wonValue] = await Promise.all([
      crmDealRepository.pipelineValueByCurrency(organizationId, input.pipelineId, tx),
      crmDealRepository.weightedForecastByCurrency(organizationId, input.pipelineId, tx),
      crmDealRepository.countOpenWithoutProbability(organizationId, input.pipelineId, tx),
      crmDealRepository.expectedClosingByCurrency(organizationId, input.pipelineId, closingFrom, closingTo, tx),
      crmDealRepository.countOpenWithoutExpectedCloseDate(organizationId, input.pipelineId, tx),
      crmDealRepository.wonValueByCurrency(organizationId, input.pipelineId, wonFrom, wonTo, tx),
    ]);

    return {
      pipelineValue,
      weightedForecast,
      weightedForecastExcludedCount,
      expectedClosing,
      expectedClosingWindow: { from: closingFrom, to: closingTo },
      expectedClosingExcludedCount,
      wonValue,
      wonWindow: { from: wonFrom, to: wonTo },
    };
  });
}
