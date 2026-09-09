import "server-only";
import { getClientSuccessHealth } from "./crm-client-success-health-service";

/**
 * Client Success AI-context extension (Build 25) — the same security
 * boundary Customer 360's own `getCustomer360AiContext()` establishes
 * (Build 24): NOT an AI agent, calls NO model. Reshapes the SAME
 * already-authorized `getClientSuccessHealth()` output (which itself
 * only ever composes `getCustomer360()` + `getOrganizationFinancialHealthForPlatform()`
 * — nothing wider) into a compact, provenance-preserving structure a
 * future AI module MAY consume. Every fact is a deterministic, already-
 * computed value — no score is invented for this purpose, no risk
 * probability is generated, and nothing here can ever grant the
 * eventual caller more access than `crm.client_success.read` already
 * did.
 */
export interface ClientSuccessAiContext {
  generatedAt: string;
  companyId: string;
  health: { overallScore: number | null; overallStatus: string; coverage: { measurable: number; total: number } };
  components: { key: string; status: string; measurable: boolean; reason: string; source: string }[];
  churnRisk: { level: string; reasons: { code: string; message: string }[] };
  csOwnerUserId: string | null;
  managementAttentionFlag: boolean;
}

export async function getClientSuccessAiContext(rawInput: { companyId: string }): Promise<ClientSuccessAiContext> {
  const view = await getClientSuccessHealth(rawInput);
  return {
    generatedAt: new Date().toISOString(),
    companyId: view.company360.company.id,
    health: { overallScore: view.health.overallScore, overallStatus: view.health.overallStatus, coverage: view.health.coverage },
    components: view.health.components.map((c) => ({ key: c.key, status: c.status, measurable: c.measurable, reason: c.reason, source: c.source })),
    churnRisk: { level: view.churnRisk.level, reasons: view.churnRisk.reasons.map((r) => ({ code: r.code, message: r.message })) },
    csOwnerUserId: view.csProfile?.csOwnerUserId ?? null,
    managementAttentionFlag: view.csProfile?.managementAttentionFlag ?? false,
  };
}
