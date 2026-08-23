import "server-only";
import { z } from "zod";
import { parseOrThrow } from "@/lib/validation/parse";
import { requirePermission } from "@/lib/authorization/authorize";
import { withTenantContext } from "@/lib/tenancy/context";
import { aiConversationRepository } from "@/server/repositories/ai-conversation-repository";
import { organizationRepository } from "@/server/repositories/organization-repository";
import { resolvePeriod, customPeriod, PERIOD_NAMES, type FinancialPeriod, type PeriodName } from "@/lib/billing/reporting/period";

/**
 * Platform-wide AI usage/cost observability (Module 17) —
 * `ai.observability`, mirroring Module 09's `notification-observability`
 * shape exactly: operational metadata across every organization, never
 * a grant of any one organization's actual conversation content (no
 * message text anywhere in this file's output types).
 *
 * Reuses `FinancialPeriod`/`resolvePeriod()` from
 * `lib/billing/reporting/period.ts` (Module 15) directly — genuinely
 * domain-agnostic date-range logic despite living under a `billing/`
 * path; duplicating it under `lib/ai/` for a cosmetic import-path
 * reason would violate this codebase's own "no duplicated abstractions"
 * rule for a purely cosmetic gain.
 */

const periodInputSchema = z.union([z.object({ period: z.enum(PERIOD_NAMES) }), z.object({ periodStart: z.coerce.date(), periodEnd: z.coerce.date() })]);

function resolveRequestedPeriod(input: z.infer<typeof periodInputSchema>): FinancialPeriod {
  if ("period" in input) return resolvePeriod(input.period as PeriodName, "UTC", new Date());
  return customPeriod(input.periodStart, input.periodEnd, "UTC");
}

export interface AiUsageByOrganization {
  organizationId: string;
  organizationName: string;
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  /** Minor USD units — an ESTIMATE, see `lib/ai/pricing.ts`'s own top comment. */
  costMinorUnits: number;
}

export interface AiUsageSummary {
  period: FinancialPeriod;
  byOrganization: AiUsageByOrganization[];
  totals: { messageCount: number; inputTokens: number; outputTokens: number; costMinorUnits: number };
}

/** `ai.observability` — platform-wide AI usage/cost, broken down by organization, for a period. */
export async function getPlatformAiUsageSummary(rawInput: unknown): Promise<AiUsageSummary> {
  await requirePermission("ai.observability");
  const input = parseOrThrow(periodInputSchema, rawInput);
  const period = resolveRequestedPeriod(input);

  const rows = await withTenantContext({ userId: null, organizationId: null, isPlatformStaff: true }, (tx) => aiConversationRepository.sumUsageByOrganization({ platform: true }, period, tx));

  // Same "resolve display name via individual findById() calls" idiom
  // `financial-health-service.ts`'s own `listAtRiskOrganizations()`
  // already establishes — the row count here (organizations with real
  // AI usage in one period) is never large enough to justify a new
  // batch-lookup repository method.
  const byOrganization = (
    await Promise.all(
      rows.map(async (r) => {
        const organization = await organizationRepository.findById(r.organizationId);
        return { ...r, organizationName: organization?.displayName ?? "(deleted organization)" };
      }),
    )
  ).sort((a, b) => b.costMinorUnits - a.costMinorUnits);

  const totals = byOrganization.reduce(
    (acc, r) => ({
      messageCount: acc.messageCount + r.messageCount,
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      costMinorUnits: acc.costMinorUnits + r.costMinorUnits,
    }),
    { messageCount: 0, inputTokens: 0, outputTokens: 0, costMinorUnits: 0 },
  );

  return { period, byOrganization, totals };
}
