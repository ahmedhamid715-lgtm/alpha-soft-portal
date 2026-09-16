"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateEcommerceStoreConfigurationAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { EcommerceStore, WebsiteConfigurationState } from "@/generated/prisma/client";

const CONFIG_FIELDS: { key: keyof Pick<EcommerceStore, "checkoutConfigured" | "paymentConfigured" | "shippingConfigured" | "taxConfigured" | "discountsConfigured" | "inventoryConfigured">; label: string }[] = [
  { key: "checkoutConfigured", label: "Checkout configured" },
  { key: "paymentConfigured", label: "Payment configured" },
  { key: "shippingConfigured", label: "Shipping configured" },
  { key: "taxConfigured", label: "Tax configured" },
  { key: "discountsConfigured", label: "Discounts configured" },
  { key: "inventoryConfigured", label: "Inventory configured" },
];

/**
 * Commerce configuration STATE ONLY (Build 33 — Roadmap Module 27) — a
 * manually-observed fact recorded by the team, never a live
 * provider-connection check (no Shopify/WooCommerce/payment-gateway
 * integration exists in this build — see docs/architecture/
 * ecommerce-development-os.md "Integration boundary"). `paymentProviderLabel`
 * is a free-text label ("Stripe", "PayPal") screened for embedded
 * credentials — Alpha OS never stores a merchant credential or payment
 * secret, ever.
 */
export function ConfigurationTab({ store, canManage }: { store: EcommerceStore; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const providerLabelId = useId();
  const fieldIds = {
    checkoutConfigured: useId(),
    paymentConfigured: useId(),
    shippingConfigured: useId(),
    taxConfigured: useId(),
    discountsConfigured: useId(),
    inventoryConfigured: useId(),
  };

  function handleSave(formData: FormData) {
    const providerLabel = formData.get("paymentProviderLabel");
    const input: Record<string, unknown> = {
      storeId: store.id,
      paymentProviderLabel: typeof providerLabel === "string" && providerLabel.trim().length > 0 ? providerLabel.trim() : null,
    };
    for (const { key } of CONFIG_FIELDS) {
      const value = formData.get(key);
      if (typeof value === "string") input[key] = value as WebsiteConfigurationState;
    }
    startTransition(async () => {
      const result = await updateEcommerceStoreConfigurationAction(input);
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {CONFIG_FIELDS.map(({ key, label }) => (
              <Field key={key} label={label} value={store[key]} />
            ))}
            <Field label="Payment provider" value={store.paymentProviderLabel ?? "Not recorded"} />
          </div>
        </CardContent>
      </Card>

      {canManage ? (
        <Card>
          <CardContent>
            <form action={handleSave} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-end gap-2">
                {CONFIG_FIELDS.map(({ key, label }) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <Label htmlFor={fieldIds[key]}>{label}</Label>
                    <Select name={key} defaultValue={store[key]} disabled={pending}>
                      <SelectTrigger id={fieldIds[key]} className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="YES">Yes</SelectItem>
                        <SelectItem value="NO">No</SelectItem>
                        <SelectItem value="UNKNOWN">Unknown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={providerLabelId}>Payment provider (label only — never a credential)</Label>
                  <Input id={providerLabelId} name="paymentProviderLabel" defaultValue={store.paymentProviderLabel ?? ""} placeholder="Stripe" disabled={pending} className="w-56" />
                </div>
                <Button type="submit" size="sm" disabled={pending}>
                  {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                  Save
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
