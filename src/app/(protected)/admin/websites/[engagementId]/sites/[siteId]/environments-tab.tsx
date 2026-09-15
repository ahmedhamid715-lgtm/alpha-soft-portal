"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { recordWebsiteEnvironmentAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { websiteEnvironmentStatusVariant, WEBSITE_ENVIRONMENT_TYPE_LABELS } from "@/components/website-dev/website-status";
import type { WebsiteEnvironment, WebsiteEnvironmentType, WebsiteEnvironmentStatus } from "@/generated/prisma/client";

const ENVIRONMENT_TYPES: WebsiteEnvironmentType[] = ["LOCAL", "DEVELOPMENT", "STAGING", "PRODUCTION"];

/**
 * At most one row per (site, type) — a real UNIQUE index, upserted via
 * `recordWebsiteEnvironment()`. URLs here are metadata only — Alpha OS
 * never fetches a customer's site URL for a "health check" (see
 * docs/architecture/website-development-os.md "Environment URL
 * security"). No credentials of any kind.
 */
export function EnvironmentsTab({ siteId, initialItems, canManage }: { siteId: string; initialItems: WebsiteEnvironment[]; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingType, setEditingType] = useState<WebsiteEnvironmentType | null>(null);
  const router = useRouter();
  const byType = new Map(initialItems.map((e) => [e.type, e]));

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

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        {ENVIRONMENT_TYPES.map((type) => {
          const environment = byType.get(type) ?? null;
          return (
            <Card key={type}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{WEBSITE_ENVIRONMENT_TYPE_LABELS[type]}</span>
                    {environment?.url ? <span className="text-xs text-muted-foreground">{environment.url}</span> : <span className="text-xs text-muted-foreground">No URL recorded</span>}
                    {environment?.providerLabel ? <span className="text-xs text-muted-foreground">Provider: {environment.providerLabel}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {environment?.customerVisible ? <StatusBadge status="info">Customer-visible</StatusBadge> : null}
                    <StatusBadge status={environment ? websiteEnvironmentStatusVariant(environment.status) : "neutral"}>{environment ? environment.status.replace(/_/g, " ") : "NOT SET UP"}</StatusBadge>
                    {canManage ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setEditingType(editingType === type ? null : type)}>
                        {environment ? "Edit" : "Record"}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {editingType === type ? (
                  <EnvironmentForm
                    siteId={siteId}
                    type={type}
                    environment={environment}
                    pending={pending}
                    onSubmit={(input) => runAction(() => recordWebsiteEnvironmentAction(input), () => setEditingType(null))}
                    onCancel={() => setEditingType(null)}
                  />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function EnvironmentForm({
  siteId,
  type,
  environment,
  pending,
  onSubmit,
  onCancel,
}: {
  siteId: string;
  type: WebsiteEnvironmentType;
  environment: WebsiteEnvironment | null;
  pending: boolean;
  onSubmit: (input: unknown) => void;
  onCancel: () => void;
}) {
  const urlId = useId();
  const statusId = useId();
  const providerId = useId();
  const visibleId = useId();

  function handleSubmit(formData: FormData) {
    const url = formData.get("url");
    const status = formData.get("status");
    const providerLabel = formData.get("providerLabel");
    onSubmit({
      siteId,
      type,
      url: typeof url === "string" && url.trim().length > 0 ? url.trim() : null,
      status: typeof status === "string" ? (status as WebsiteEnvironmentStatus) : "ACTIVE",
      providerLabel: typeof providerLabel === "string" && providerLabel.trim().length > 0 ? providerLabel.trim() : null,
      customerVisible: formData.get("customerVisible") === "on",
    });
  }

  return (
    <form action={handleSubmit} className="flex flex-wrap items-end gap-2 border-t pt-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={urlId}>URL</Label>
        <Input id={urlId} name="url" type="url" defaultValue={environment?.url ?? ""} placeholder="https://staging.example.com" disabled={pending} className="w-64" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={statusId}>Status</Label>
        <Select name="status" defaultValue={environment?.status ?? "ACTIVE"} disabled={pending}>
          <SelectTrigger id={statusId} className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NOT_SET_UP">Not set up</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={providerId}>Provider label</Label>
        <Input id={providerId} name="providerLabel" defaultValue={environment?.providerLabel ?? ""} placeholder="Vercel" disabled={pending} className="w-40" />
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Checkbox id={visibleId} name="customerVisible" defaultChecked={environment?.customerVisible ?? false} disabled={pending} />
        <Label htmlFor={visibleId} className="font-normal">
          Show URL in Customer Portal
        </Label>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}
