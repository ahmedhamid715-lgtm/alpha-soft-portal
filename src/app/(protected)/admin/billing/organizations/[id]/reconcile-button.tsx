"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { reconcileOrganizationBillingAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * Reconciliation (spec §39) — DETECTS divergence between Alpha OS and
 * Stripe, never repairs it. Called directly (awaited), not through
 * `useActionState`, since the result is a report to render inline, not
 * a redirect/revalidate outcome.
 */
export function ReconcileButton({ organizationId }: { organizationId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  const [result, setResult] = useState<Awaited<ReturnType<typeof reconcileOrganizationBillingAction>>["result"] | undefined>(undefined);

  function run() {
    setError(undefined);
    setResult(undefined);
    startTransition(async () => {
      const outcome = await reconcileOrganizationBillingAction(organizationId);
      if (outcome.error) setError(outcome.error);
      else setResult(outcome.result);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={run} disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        Run reconciliation check
      </Button>
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {result ? (
        result.divergences === null || result.divergences.length === 0 ? (
          <Alert>
            <CheckCircle2 />
            <AlertDescription>
              {!result.hasBillingAccount
                ? "No billing account yet — nothing to compare."
                : !result.hasLocalSubscription
                  ? "No local subscription yet — nothing to compare."
                  : "No divergence found. Alpha OS and Stripe agree."}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" role="alert">
            <AlertTriangle />
            <AlertDescription>
              <div className="flex flex-col gap-1">
                <span className="font-medium">Divergence detected — this was reported, not repaired.</span>
                <ul className="list-inside list-disc text-sm">
                  {result.divergences.map((d) => (
                    <li key={d.field}>
                      <span className="font-mono">{d.field}</span>: Alpha OS says <span className="font-mono">{d.local}</span>, Stripe says <span className="font-mono">{d.remote}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        )
      ) : null}
    </div>
  );
}
