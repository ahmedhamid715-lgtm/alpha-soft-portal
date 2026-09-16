"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, ShoppingCart } from "lucide-react";
import { createEcommerceStoreAction, createAndLinkEcommerceProjectAction, linkExistingEcommerceProjectAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { ecommerceStoreStatusVariant, ECOMMERCE_PLATFORM_LABELS } from "@/components/ecommerce/ecommerce-status";
import type { EcommerceEngagementDetail } from "@/server/services/ecommerce-engagement-service";
import type { EcommerceStorePlatform } from "@/generated/prisma/client";

export function EngagementWorkspace({ detail, canManage }: { detail: EcommerceEngagementDetail; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAddStore, setShowAddStore] = useState(false);
  const [showLinkProject, setShowLinkProject] = useState(false);
  const router = useRouter();
  const nameId = useId();
  const platformId = useId();
  const externalIdId = useId();
  const storeUrlId = useId();
  const currencyId = useId();
  const projectTitleId = useId();
  const projectDescId = useId();
  const existingProjectId = useId();

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

  function handleAddStore(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createEcommerceStoreAction({
          engagementId: detail.engagement.id,
          name: str("name") ?? "",
          platform: (str("platform") ?? "OTHER") as EcommerceStorePlatform,
          externalStoreIdentifier: str("externalStoreIdentifier"),
          storeUrl: str("storeUrl"),
          currency: str("currency"),
        }),
      () => setShowAddStore(false),
    );
  }

  function handleCreateProject(formData: FormData) {
    const str = (key: string) => {
      const v = formData.get(key);
      return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    };
    runAction(
      () =>
        createAndLinkEcommerceProjectAction({
          engagementId: detail.engagement.id,
          title: str("title") ?? "",
          description: str("description"),
        }),
      () => setShowLinkProject(false),
    );
  }

  function handleLinkExistingProject(formData: FormData) {
    const projectId = formData.get("projectId");
    if (typeof projectId !== "string" || projectId.trim().length === 0) return;
    runAction(() => linkExistingEcommerceProjectAction({ engagementId: detail.engagement.id, projectId: projectId.trim() }), () => setShowLinkProject(false));
  }

  return (
    <div className="flex flex-col gap-8">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Delivery project" />
        {detail.linkedProjectTitle ? (
          <p className="text-sm text-muted-foreground">
            Delivered through <span className="font-medium text-foreground">{detail.linkedProjectTitle}</span> in Project Management.
          </p>
        ) : canManage ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">No Project Management project linked yet. Catalog/QA/task delivery work lives in Project Management, not here.</p>
            <Button size="sm" variant="outline" className="w-fit" onClick={() => setShowLinkProject((v) => !v)}>
              Link or create a project
            </Button>
            {showLinkProject ? (
              <Card>
                <CardContent className="flex flex-col gap-4">
                  <form action={handleCreateProject} className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Create a new project</p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={projectTitleId}>Project title</Label>
                        <Input id={projectTitleId} name="title" required disabled={pending} className="w-64" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={projectDescId}>Description</Label>
                        <Input id={projectDescId} name="description" disabled={pending} className="w-64" />
                      </div>
                      <Button type="submit" disabled={pending}>
                        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                        Create &amp; link
                      </Button>
                    </div>
                  </form>
                  <form action={handleLinkExistingProject} className="flex flex-wrap items-end gap-2 border-t pt-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={existingProjectId}>Existing project ID</Label>
                      <Input id={existingProjectId} name="projectId" placeholder="Project UUID" disabled={pending} className="w-64" />
                    </div>
                    <Button type="submit" variant="outline" disabled={pending}>
                      Link existing
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No Project Management project linked yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionHeader title="Stores" />
          {canManage ? (
            <Button size="sm" variant="outline" onClick={() => setShowAddStore((v) => !v)}>
              Add store
            </Button>
          ) : null}
        </div>

        {showAddStore ? (
          <Card>
            <CardContent>
              <form action={handleAddStore} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={nameId}>Store name</Label>
                    <Input id={nameId} name="name" required disabled={pending} className="w-56" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={platformId}>Platform</Label>
                    <Select name="platform" defaultValue="OTHER" disabled={pending}>
                      <SelectTrigger id={platformId} className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(ECOMMERCE_PLATFORM_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={externalIdId}>External store identifier (optional)</Label>
                    <Input id={externalIdId} name="externalStoreIdentifier" placeholder="Shopify shop domain, etc." disabled={pending} className="w-56" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={currencyId}>Currency (ISO, optional)</Label>
                    <Input id={currencyId} name="currency" placeholder="USD" maxLength={3} disabled={pending} className="w-24" />
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={storeUrlId}>Store URL (headless / no linked website site, optional)</Label>
                    <Input id={storeUrlId} name="storeUrl" type="url" placeholder="https://shop.example.com" disabled={pending} className="w-72" />
                  </div>
                  <Button type="submit" disabled={pending}>
                    {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                    Add store
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Linking an existing Website Development site to this store is available from the store&apos;s own overview once created.</p>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {detail.stores.length === 0 ? (
          <EmptyState icon={ShoppingCart} title="No stores tracked yet" description="Add a store to start tracking catalog, configuration, QA readiness, and launches." />
        ) : (
          <div className="flex flex-col gap-2">
            {detail.stores.map(({ store, productCount, websiteSiteName }) => (
              <Link key={store.id} href={`/admin/ecommerce/${detail.engagement.id}/stores/${store.id}`}>
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{store.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {ECOMMERCE_PLATFORM_LABELS[store.platform]} · {productCount} product(s){websiteSiteName ? ` · linked to ${websiteSiteName}` : ""}
                      </span>
                    </div>
                    <StatusBadge status={ecommerceStoreStatusVariant(store.status)}>{store.status.replace("_", " ")}</StatusBadge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
