"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  updateCustomerServiceAction,
  setCustomerServiceOwnerAction,
  activateCustomerServiceAction,
  pauseCustomerServiceAction,
  resumeCustomerServiceAction,
  completeCustomerServiceAction,
  reopenCustomerServiceAction,
  cancelCustomerServiceAction,
} from "../../actions";
import { createSeoEngagementAction } from "../../../seo/actions";
import { createLocalSeoEngagementAction } from "../../../local-seo/actions";
import { createWebsiteEngagementAction } from "../../../websites/actions";
import { createEcommerceEngagementAction } from "../../../ecommerce/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { SectionHeader } from "@/components/layout/section-header";
import { customerServiceStatusVariant, SERVICE_CATEGORY_LABELS } from "@/components/services/service-status";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { projectStatusVariant } from "@/components/projects/project-status";
import type { CustomerServiceDetail } from "@/server/services/customer-service-service";
import type { User } from "@/generated/prisma/client";

export function CustomerServiceDetailView({
  detail,
  canManage,
  assignableUsers,
  canSeeSeo,
  canManageSeo,
  seoEngagementId,
  canSeeLocalSeo,
  canManageLocalSeo,
  localSeoEngagementId,
  canSeeWebsiteDev,
  canManageWebsiteDev,
  websiteEngagementId,
  canSeeEcommerce,
  canManageEcommerce,
  ecommerceEngagementId,
}: {
  detail: CustomerServiceDetail;
  canManage: boolean;
  assignableUsers: User[];
  canSeeSeo: boolean;
  canManageSeo: boolean;
  seoEngagementId: string | null;
  canSeeLocalSeo: boolean;
  canManageLocalSeo: boolean;
  localSeoEngagementId: string | null;
  canSeeWebsiteDev: boolean;
  canManageWebsiteDev: boolean;
  websiteEngagementId: string | null;
  canSeeEcommerce: boolean;
  canManageEcommerce: boolean;
  ecommerceEngagementId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const router = useRouter();
  const quantityId = useId();
  const startDateId = useId();
  const targetEndDateId = useId();
  const ownerId = useId();
  const reasonId = useId();

  function runAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  function handleSave(formData: FormData) {
    const quantity = formData.get("quantity");
    const startDate = formData.get("startDate");
    const targetEndDate = formData.get("targetEndDate");
    runAction(() =>
      updateCustomerServiceAction({
        customerServiceId: detail.id,
        quantity: typeof quantity === "string" && quantity.length > 0 ? quantity : undefined,
        startDate: typeof startDate === "string" ? (startDate.length > 0 ? `${startDate}T00:00:00.000Z` : null) : undefined,
        targetEndDate: typeof targetEndDate === "string" ? (targetEndDate.length > 0 ? `${targetEndDate}T00:00:00.000Z` : null) : undefined,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={customerServiceStatusVariant(detail.status)}>{detail.status}</StatusBadge>
        <StatusBadge status="neutral">{SERVICE_CATEGORY_LABELS[detail.category]}</StatusBadge>
        <span className="text-xs text-muted-foreground">{detail.customerOrganizationName}</span>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {detail.status === "PENDING" ? (
            <Button variant="outline" disabled={pending} onClick={() => runAction(() => activateCustomerServiceAction({ customerServiceId: detail.id }))}>
              Activate
            </Button>
          ) : null}
          {detail.status === "ACTIVE" ? (
            <>
              <Button variant="outline" disabled={pending} onClick={() => runAction(() => pauseCustomerServiceAction({ customerServiceId: detail.id }))}>
                Pause
              </Button>
              <Button variant="outline" disabled={pending} onClick={() => runAction(() => completeCustomerServiceAction({ customerServiceId: detail.id }))}>
                Mark complete
              </Button>
            </>
          ) : null}
          {detail.status === "PAUSED" ? (
            <Button variant="outline" disabled={pending} onClick={() => runAction(() => resumeCustomerServiceAction({ customerServiceId: detail.id }))}>
              Resume
            </Button>
          ) : null}
          {detail.status === "COMPLETED" ? (
            <Button variant="outline" disabled={pending} onClick={() => runAction(() => reopenCustomerServiceAction({ customerServiceId: detail.id }))}>
              Reopen
            </Button>
          ) : null}
          {(detail.status === "PENDING" || detail.status === "ACTIVE" || detail.status === "PAUSED") ? (
            <Button variant="ghost" disabled={pending} onClick={() => setShowCancel((v) => !v)}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}

      {showCancel ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Label htmlFor={reasonId}>Cancellation reason</Label>
            <Input id={reasonId} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={1000} required />
            <Button
              variant="destructive"
              disabled={pending || cancelReason.trim().length === 0}
              onClick={() =>
                runAction(async () => {
                  const result = await cancelCustomerServiceAction({ customerServiceId: detail.id, reason: cancelReason });
                  if (!result.error) setShowCancel(false);
                  return result;
                })
              }
              className="w-fit"
            >
              Confirm cancellation
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <form action={canManage ? handleSave : undefined} className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={quantityId}>Quantity</Label>
                <Input id={quantityId} name="quantity" type="number" min={1} defaultValue={detail.quantity} disabled={!canManage || pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={startDateId}>Start date</Label>
                <Input id={startDateId} name="startDate" type="date" defaultValue={detail.startDate ? detail.startDate.toISOString().slice(0, 10) : ""} disabled={!canManage || pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={targetEndDateId}>Target end date</Label>
                <Input id={targetEndDateId} name="targetEndDate" type="date" defaultValue={detail.targetEndDate ? detail.targetEndDate.toISOString().slice(0, 10) : ""} disabled={!canManage || pending} />
              </div>
            </div>
            {canManage ? (
              <Button type="submit" disabled={pending} className="w-fit">
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Save changes
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-1.5 max-w-xs">
        <Label htmlFor={ownerId}>Owner</Label>
        {canManage ? (
          <select
            id={ownerId}
            defaultValue={detail.ownerUserId ?? ""}
            disabled={pending}
            onChange={(e) => runAction(() => setCustomerServiceOwnerAction({ customerServiceId: detail.id, ownerUserId: e.target.value || null }))}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Unassigned</option>
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-muted-foreground">{detail.ownerName ?? "Unassigned"}</span>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <SectionHeader title="Provenance" />
        {!detail.sourceOnboardingServiceItemId ? (
          <p className="text-sm text-muted-foreground">Created manually — no proposal/onboarding provenance.</p>
        ) : !detail.canSeeProvenance ? (
          <p className="text-sm text-muted-foreground">Viewing onboarding provenance requires the crm.onboarding.read permission.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Provisioned from onboarding service item &ldquo;{detail.sourceOnboardingServiceItemTitle}&rdquo;
            {detail.sourceOnboardingId ? (
              <>
                {" — "}
                <Link href={`/admin/crm/onboarding/${detail.sourceOnboardingId}`} className="text-link underline underline-offset-4">
                  view onboarding
                </Link>
              </>
            ) : null}
          </p>
        )}
      </section>

      {detail.category === "SEO" ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="SEO workspace" />
          {!canSeeSeo ? (
            <p className="text-sm text-muted-foreground">Viewing the SEO workspace requires the seo.read permission.</p>
          ) : seoEngagementId ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/admin/seo/${seoEngagementId}`}>Open SEO workspace</Link>
            </Button>
          ) : canManageSeo ? (
            <Button
              variant="outline"
              className="w-fit"
              disabled={pending}
              onClick={() =>
                runAction(async () => {
                  const result = await createSeoEngagementAction({ customerServiceId: detail.id });
                  if (!result.error && result.data) router.push(`/admin/seo/${result.data.id}`);
                  return result;
                })
              }
            >
              Set up SEO workspace
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">No SEO workspace set up yet.</p>
          )}
        </section>
      ) : null}

      {detail.category === "LOCAL_SEO" ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Local SEO workspace" />
          {!canSeeLocalSeo ? (
            <p className="text-sm text-muted-foreground">Viewing the Local SEO workspace requires the local_seo.read permission.</p>
          ) : localSeoEngagementId ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/admin/local-seo/${localSeoEngagementId}`}>Open Local SEO workspace</Link>
            </Button>
          ) : canManageLocalSeo ? (
            <Button
              variant="outline"
              className="w-fit"
              disabled={pending}
              onClick={() =>
                runAction(async () => {
                  const result = await createLocalSeoEngagementAction({ customerServiceId: detail.id });
                  if (!result.error && result.data) router.push(`/admin/local-seo/${result.data.id}`);
                  return result;
                })
              }
            >
              Set up Local SEO workspace
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">No Local SEO workspace set up yet.</p>
          )}
        </section>
      ) : null}

      {detail.category === "WEB_DEVELOPMENT" ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="Website Development workspace" />
          {!canSeeWebsiteDev ? (
            <p className="text-sm text-muted-foreground">Viewing the Website Development workspace requires the website_development.read permission.</p>
          ) : websiteEngagementId ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/admin/websites/${websiteEngagementId}`}>Open Website workspace</Link>
            </Button>
          ) : canManageWebsiteDev ? (
            <Button
              variant="outline"
              className="w-fit"
              disabled={pending}
              onClick={() =>
                runAction(async () => {
                  const result = await createWebsiteEngagementAction({ customerServiceId: detail.id });
                  if (!result.error && result.data) router.push(`/admin/websites/${result.data.id}`);
                  return result;
                })
              }
            >
              Set up Website workspace
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">No Website workspace set up yet.</p>
          )}
        </section>
      ) : null}

      {detail.category === "ECOMMERCE" ? (
        <section className="flex flex-col gap-3">
          <SectionHeader title="E-Commerce Development workspace" />
          {!canSeeEcommerce ? (
            <p className="text-sm text-muted-foreground">Viewing the E-Commerce Development workspace requires the ecommerce_development.read permission.</p>
          ) : ecommerceEngagementId ? (
            <Button asChild variant="outline" className="w-fit">
              <Link href={`/admin/ecommerce/${ecommerceEngagementId}`}>Open E-Commerce workspace</Link>
            </Button>
          ) : canManageEcommerce ? (
            <Button
              variant="outline"
              className="w-fit"
              disabled={pending}
              onClick={() =>
                runAction(async () => {
                  const result = await createEcommerceEngagementAction({ customerServiceId: detail.id });
                  if (!result.error && result.data) router.push(`/admin/ecommerce/${result.data.id}`);
                  return result;
                })
              }
            >
              Set up E-Commerce workspace
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">No E-Commerce workspace set up yet.</p>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader title="Linked projects" />
        {!detail.canSeeLinkedProjects ? (
          <p className="text-sm text-muted-foreground">Viewing linked projects requires the delivery_projects.read permission.</p>
        ) : detail.linkedProjects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects deliver this service yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {detail.linkedProjects.map((p) => (
              <Link key={p.id} href={`/admin/projects/${p.id}`}>
                <Card className="transition-colors hover:bg-accent/50">
                  <CardContent className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium">{p.title}</span>
                    <StatusBadge status={projectStatusVariant(p.status)}>{p.status.replace("_", " ")}</StatusBadge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">Created {formatInTimeZone(detail.createdAt, "UTC", { hour: undefined, minute: undefined })}</p>
    </div>
  );
}
