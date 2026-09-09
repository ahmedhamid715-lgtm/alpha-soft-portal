import "server-only";
import { resolveCrmScope } from "./crm-shared";
import { withTenantContext } from "@/lib/tenancy/context";
import { listAtRiskOrganizations, type AtRiskOrganization } from "./financial-health-service";
import { listOnboardings } from "./crm-client-onboarding-service";
import { crmClientSuccessRenewalRepository, type CrmClientSuccessRenewalWithRelations } from "@/server/repositories/crm-client-success-renewal-repository";
import { crmClientSuccessExpansionRepository, type CrmClientSuccessExpansionWithRelations } from "@/server/repositories/crm-client-success-expansion-repository";
import { crmCompanyRepository } from "@/server/repositories/crm-company-repository";
import type { CrmClientOnboardingWithRelations } from "@/server/repositories/crm-client-onboarding-repository";

/**
 * Client Success portfolio view (Build 25) — a DELIBERATELY lean, bulk-
 * queried aggregation, NOT `getCustomer360()` called once per customer
 * (the Build 25 authorization's own explicit "CRITICAL: do not loop
 * getCustomer360() 500 times" warning). Every section below is a small,
 * fixed number of bounded, org-wide queries — the query count here does
 * NOT scale with how many customers exist beyond the bound each query
 * already carries.
 *
 * Deliberately does NOT attempt to enumerate "every customer with
 * unmeasurable health" or run the full per-customer churn-risk
 * classification at portfolio scale — neither has a bulk query shape
 * that stays proportionate, and a full per-customer risk scan is
 * exactly the N+1 this service exists to avoid. The portfolio instead
 * surfaces the SAME underlying signals `evaluateChurnRisk()` uses,
 * each from its own real bulk source, individually labeled — see
 * client-success.md "Performance"/"Portfolio view."
 */
export interface ClientSuccessPortfolio {
  paymentAtRisk: { canSee: boolean; organizations: (AtRiskOrganization & { companyId: string | null; companyName: string | null })[] };
  contractsExpiringWithoutRenewal: { contract: { id: string; contractNumber: string; endDate: Date }; company: { id: string; name: string } }[];
  openRenewals: CrmClientSuccessRenewalWithRelations[];
  openExpansions: CrmClientSuccessExpansionWithRelations[];
  blockedOnboardings: CrmClientOnboardingWithRelations[];
}

export async function getClientSuccessPortfolio(): Promise<ClientSuccessPortfolio> {
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.client_success.read");
  const canSeePaymentRisk = context.permissions.has("billing.analytics.read");

  const [atRiskOrgs, contractsExpiring, openRenewals, openExpansions, blockedOnboardings] = await Promise.all([
    canSeePaymentRisk ? listAtRiskOrganizations() : Promise.resolve([]),
    withTenantContext(tenantScope, (tx) => crmClientSuccessRenewalRepository.listActiveContractsExpiringWithoutOpenRenewal(organizationId, 30, tx)),
    withTenantContext(tenantScope, (tx) => crmClientSuccessRenewalRepository.listForOrganization(organizationId, { openOnly: true }, tx)),
    withTenantContext(tenantScope, (tx) => crmClientSuccessExpansionRepository.listForOrganization(organizationId, { status: "IDENTIFIED" }, tx)),
    listOnboardings({ status: "BLOCKED" }),
  ]);

  // One reverse-lookup query (never per-organization) to attach each
  // at-risk linked organization back to its own `CrmCompany`.
  const companies = canSeePaymentRisk
    ? await withTenantContext(tenantScope, (tx) => crmCompanyRepository.listByConvertedOrganizationIds(organizationId, atRiskOrgs.map((o) => o.organizationId), tx))
    : [];
  const companyByOrgId = new Map(companies.map((c) => [c.convertedToOrganizationId, c]));

  return {
    paymentAtRisk: {
      canSee: canSeePaymentRisk,
      organizations: atRiskOrgs.map((o) => ({ ...o, companyId: companyByOrgId.get(o.organizationId)?.id ?? null, companyName: companyByOrgId.get(o.organizationId)?.name ?? null })),
    },
    contractsExpiringWithoutRenewal: contractsExpiring,
    openRenewals,
    openExpansions,
    blockedOnboardings,
  };
}
