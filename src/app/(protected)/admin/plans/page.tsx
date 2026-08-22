import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listAllPlansForAdmin } from "@/server/services/plan-service";
import { formatMoney } from "@/lib/utils/money";
import { CreatePlanForm } from "./create-plan-form";
import { CreatePriceForm } from "./create-price-form";
import { PlanToggleButton } from "./plan-toggle-button";

export const metadata: Metadata = { title: "Plans" };

/**
 * The platform-wide plan catalog admin surface (spec §6/§24) —
 * `billing.plan.manage`. Every plan/price shown here is what
 * `plan-service.ts`'s `listActivePlans()` (the customer-facing catalog)
 * filters down from — deactivating a plan/price here is what actually
 * removes it from every organization's picker, immediately.
 */
export default async function AdminPlansPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("billing.plan.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Plans" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Managing the plan catalog requires the billing.plan.manage permission." />
      </div>
    );
  }

  const plans = await listAllPlansForAdmin();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Plans" description="The platform-wide plan catalog every organization subscribes from." />

      <section className="flex flex-col gap-4">
        <SectionHeader title="New plan" />
        <CreatePlanForm />
      </section>

      <Separator />

      <section className="flex flex-col gap-6">
        <SectionHeader title="Catalog" />
        {plans.length === 0 ? (
          <EmptyState title="No plans yet" description="Create one above to get started." />
        ) : (
          plans.map((plan) => (
            <Card key={plan.id}>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">
                      {plan.name} <span className="font-mono text-xs text-muted-foreground">({plan.key})</span>
                    </p>
                    {plan.description ? <p className="text-sm text-muted-foreground">{plan.description}</p> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={plan.active ? "success" : "neutral"}>{plan.active ? "Active" : "Inactive"}</StatusBadge>
                    <PlanToggleButton id={plan.id} active={plan.active} kind="plan" />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  {plan.prices.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No prices yet.</p>
                  ) : (
                    plan.prices.map((price) => (
                      <div key={price.id} className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm">
                        <span>
                          {formatMoney(price.unitAmount, price.currency)} / {price.interval === "YEAR" ? "year" : "month"}
                          {price.providerPriceId ? null : <span className="ml-2 text-xs text-warning">not synced to Stripe</span>}
                        </span>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={price.active ? "success" : "neutral"}>{price.active ? "Active" : "Inactive"}</StatusBadge>
                          <PlanToggleButton id={price.id} active={price.active} kind="price" />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <CreatePriceForm planId={plan.id} />
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  );
}
