"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, FileText } from "lucide-react";
import { createWebsitePageAction, transitionWebsitePageStatusAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { websitePageStatusVariant } from "@/components/website-dev/website-status";
import type { WebsitePage, WebsitePageType, WebsitePageStatus } from "@/generated/prisma/client";

const PAGE_STATUSES: WebsitePageStatus[] = ["PLANNED", "IN_PROGRESS", "QA", "READY_FOR_LAUNCH", "LIVE", "ARCHIVED"];
const PAGE_TYPES: WebsitePageType[] = ["PAGE", "TEMPLATE", "COMPONENT", "OTHER"];

/** The page/template inventory (Build 32 — Roadmap Module 26). Bounded to 100 rows per load — see `page.tsx`'s own `listWebsitePages()` call; a real page-count table with hundreds of pages should paginate further, out of scope for this first pass. */
export function PagesTab({ siteId, initialItems, hasNextPage, canManage }: { siteId: string; initialItems: WebsitePage[]; hasNextPage: boolean; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const router = useRouter();
  const titleId = useId();
  const pathId = useId();
  const pageTypeId = useId();
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
    const title = formData.get("title");
    const path = formData.get("path");
    const pageType = formData.get("pageType");
    runAction(
      () =>
        createWebsitePageAction({
          siteId,
          title: typeof title === "string" ? title : "",
          path: typeof path === "string" ? path : "",
          pageType: typeof pageType === "string" ? (pageType as WebsitePageType) : "PAGE",
          required: formData.get("required") === "on",
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
            Add page
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
                <Label htmlFor={pathId}>Path</Label>
                <Input id={pathId} name="path" placeholder="/about" required disabled={pending} className="w-48" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={pageTypeId}>Type</Label>
                <Select name="pageType" defaultValue="PAGE" disabled={pending}>
                  <SelectTrigger id={pageTypeId} className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAGE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-2">
                <Checkbox id={requiredId} name="required" defaultChecked disabled={pending} />
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
        <EmptyState icon={FileText} title="No pages tracked yet" description="Add a page to start tracking its development/QA status." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Pages table, scrollable on narrow viewports">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Path</th>
                <th className="px-4 py-2.5">Title</th>
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
                  <td className="px-4 py-2.5 font-mono text-xs">{p.path}</td>
                  <td className="px-4 py-2.5 font-medium">{p.title}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.pageType}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.required ? "Yes" : "No"}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={websitePageStatusVariant(p.status)}>{p.status.replace(/_/g, " ")}</StatusBadge>
                  </td>
                  {canManage ? (
                    <td className="px-4 py-2.5 text-right">
                      <Select
                        value={p.status}
                        disabled={pending}
                        onValueChange={(value) => runAction(() => transitionWebsitePageStatusAction({ pageId: p.id, status: value as WebsitePageStatus }))}
                      >
                        <SelectTrigger className="ml-auto w-44" aria-label={`Change status for ${p.title}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAGE_STATUSES.map((s) => (
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
      {hasNextPage ? <p className="text-xs text-muted-foreground">Showing the first 100 pages. Additional pages are not shown here yet.</p> : null}
    </div>
  );
}
