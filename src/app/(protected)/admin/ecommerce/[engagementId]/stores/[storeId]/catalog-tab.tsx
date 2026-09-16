"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Package } from "lucide-react";
import { createEcommerceProductAction, transitionEcommerceProductStatusAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ecommerceProductStatusVariant } from "@/components/ecommerce/ecommerce-status";
import type { EcommerceProduct, EcommerceProductStatus } from "@/generated/prisma/client";

const PRODUCT_STATUSES: EcommerceProductStatus[] = ["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"];

/** The product catalog (Build 33 — Roadmap Module 27). Bounded to 100 rows per load — see `page.tsx`'s own `listEcommerceProducts()` call; a real catalog with hundreds of products should paginate further, out of scope for this first pass. Variants/collections are managed from a product's own detail once created — this first pass focuses on the product-level inventory list, the same scope CSV import itself covers (see the Import tab). */
export function CatalogTab({ storeId, initialItems, hasNextPage, canManage }: { storeId: string; initialItems: EcommerceProduct[]; hasNextPage: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();
  const titleId = useId();
  const handleId = useId();
  const productTypeId = useId();
  const vendorId = useId();
  const requiredId = useId();

  function runAction(action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function handleAdd(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createEcommerceProductAction({
          storeId,
          title: str("title") ?? "",
          handle: str("handle"),
          productType: str("productType"),
          vendor: str("vendor"),
          requiredForLaunch: formData.get("requiredForLaunch") === "on",
        }),
      () => setShowAdd(false),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <div className="flex items-center justify-between">
          <span />
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            Add product
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAdd} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={titleId}>Title</Label>
                <Input id={titleId} name="title" required disabled={pending} className="w-56" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={handleId}>Handle (optional)</Label>
                <Input id={handleId} name="handle" placeholder="blue-t-shirt" disabled={pending} className="w-48" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={productTypeId}>Product type (optional)</Label>
                <Input id={productTypeId} name="productType" disabled={pending} className="w-40" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={vendorId}>Vendor (optional)</Label>
                <Input id={vendorId} name="vendor" disabled={pending} className="w-40" />
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id={requiredId} name="requiredForLaunch" defaultChecked disabled={pending} />
                <Label htmlFor={requiredId} className="font-normal">
                  Required for launch
                </Label>
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Add
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={Package} title="No products tracked yet" description="Add a product or import a CSV to start tracking catalog development/QA status." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Products table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Title</th>
                <th className="px-4 py-2.5">Handle</th>
                <th className="px-4 py-2.5">Type</th>
                <th className="px-4 py-2.5">Required</th>
                <th className="px-4 py-2.5">Status</th>
                {canManage ? (
                  <th className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {initialItems.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-medium">{p.title}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.handle ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.productType ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.requiredForLaunch ? "Yes" : "No"}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={ecommerceProductStatusVariant(p.status)}>{p.status.replace(/_/g, " ")}</StatusBadge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 text-right">
                      <Select
                        value={p.status}
                        disabled={pending}
                        onValueChange={(value) => runAction(() => transitionEcommerceProductStatusAction({ productId: p.id, status: value as EcommerceProductStatus }))}
                      >
                        <SelectTrigger className="ml-auto w-44" aria-label={`Change status for ${p.title}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {hasNextPage ? <p className="text-xs text-muted-foreground">Showing the first 100 products. Additional products are not shown here yet.</p> : null}
    </div>
  );
}
