"use client";

import { useActionState, useState, useTransition } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { previewPlanChangeAction, changeSubscriptionPlanAction, type BillingActionState, type PlanChangePreviewState } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { formatMoney } from "@/lib/utils/money";

const initialApplyState: BillingActionState = {};

interface ChangePlanPrice {
  id: string;
  unitAmount: number;
  currency: string;
  interval: "MONTH" | "YEAR";
}

interface ChangePlanOption {
  id: string;
  name: string;
  prices: ChangePlanPrice[];
}

/**
 * Upgrade/downgrade an EXISTING subscription (spec §5/§35) — distinct
 * from `PlanPicker` (which only ever starts a brand-new subscription via
 * Checkout). This updates the current Stripe subscription item in place
 * via `changeSubscriptionPlan()`, never a second competing subscription.
 *
 * Two-step, preview-then-confirm (spec §5: "show the customer exact
 * numbers before they confirm, never fabricate them"): selecting a price
 * fetches a REAL provider proration preview; the confirm dialog shows
 * exactly what `previewSubscriptionChange()` returned, never a locally
 * computed estimate. If the provider can't preview right now, that's
 * shown honestly too — the confirm step still works, just without a
 * number attached.
 */
export function ChangePlanControl({
  organizationId,
  currentPlanPriceId,
  plans,
}: {
  organizationId: string;
  currentPlanPriceId: string | null;
  plans: ChangePlanOption[];
}) {
  const [selectedPriceId, setSelectedPriceId] = useState("");
  const [previewState, setPreviewState] = useState<PlanChangePreviewState | null>(null);
  const [previewPending, startPreviewTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyState, applyAction] = useActionState(changeSubscriptionPlanAction, initialApplyState);
  const [applyPending, startApplyTransition] = useTransition();

  const options = plans.flatMap((plan) =>
    plan.prices.filter((price) => price.id !== currentPlanPriceId).map((price) => ({ ...price, planName: plan.name })),
  );
  const selected = options.find((o) => o.id === selectedPriceId);

  if (options.length === 0) return null;

  function requestPreview() {
    if (!selectedPriceId) return;
    setPreviewState(null);
    startPreviewTransition(async () => {
      const result = await previewPlanChangeAction({ organizationId, planPriceId: selectedPriceId });
      setPreviewState(result);
      setConfirmOpen(true);
    });
  }

  function confirmChange() {
    const formData = new FormData();
    formData.set("organizationId", organizationId);
    formData.set("planPriceId", selectedPriceId);
    setConfirmOpen(false);
    startApplyTransition(() => applyAction(formData));
  }

  const preview = previewState?.preview;
  const description = previewState?.error
    ? previewState.error
    : preview && preview.available
      ? `You'll be charged ${formatMoney(preview.immediateChangeAmount ?? 0, preview.currency ?? "USD")} today, then ${formatMoney(preview.totalAmount ?? 0, preview.currency ?? "USD")} on your next renewal (${preview.effectiveAt ? new Date(preview.effectiveAt).toLocaleDateString() : "your next billing date"}).`
      : "The exact charge couldn't be previewed right now — the change will still apply immediately, and your next invoice will reflect it.";

  return (
    <div className="flex flex-col gap-2">
      {applyState.error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{applyState.error}</AlertDescription>
        </Alert>
      ) : null}
      {applyState.success ? <p className="text-sm text-success">Plan change requested — it will apply shortly.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedPriceId}
          onChange={(e) => setSelectedPriceId(e.target.value)}
          className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm"
          aria-label="Change plan to"
        >
          <option value="">Change plan…</option>
          {options.map((price) => (
            <option key={price.id} value={price.id}>
              {price.planName} — {formatMoney(price.unitAmount, price.currency)} / {price.interval === "YEAR" ? "yr" : "mo"}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" onClick={requestPreview} disabled={!selectedPriceId || previewPending || applyPending}>
          {previewPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          Preview change
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Change to ${selected ? `${selected.planName} (${formatMoney(selected.unitAmount, selected.currency)}/${selected.interval === "YEAR" ? "yr" : "mo"})` : "this plan"}?`}
        description={description}
        confirmLabel="Confirm plan change"
        loading={applyPending}
        onConfirm={confirmChange}
      />
    </div>
  );
}
