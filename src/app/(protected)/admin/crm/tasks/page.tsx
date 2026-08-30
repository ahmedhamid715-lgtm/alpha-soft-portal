import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listTasks } from "@/server/services/crm-task-service";
import { CrmTaskList } from "@/components/crm/task-list";
import { CrmPaginationControls } from "@/components/crm/pagination-controls";
import { EmptyState } from "@/components/shared/empty-state";
import type { CrmTaskStatus } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "CRM Tasks" };

export default async function CrmTasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Tasks" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Tasks" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const page = Number(single(sp.page) ?? "1") || 1;
  const status = (single(sp.status) as CrmTaskStatus | undefined) ?? "OPEN";
  const mineOnly = single(sp.assignee) !== "everyone";

  const result = await listTasks({ page, limit: 25, status, assignedToUserId: mineOnly ? context.user!.id : undefined });

  const filterParams = new URLSearchParams();
  filterParams.set("status", status);
  filterParams.set("assignee", mineOnly ? "me" : "everyone");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Tasks" description="CRM follow-ups — scoped to the lead, company, or contact each one belongs to." breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Tasks" }]} />

      <section className="flex flex-col gap-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="task-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select id="task-status" name="status" defaultValue={status} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              {(["OPEN", "COMPLETED", "CANCELLED"] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-assignee-filter" className="text-xs text-muted-foreground">
              Assignee
            </label>
            <select id="task-assignee-filter" name="assignee" defaultValue={mineOnly ? "me" : "everyone"} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="me">Assigned to me</option>
              <option value="everyone">Everyone</option>
            </select>
          </div>
          <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
            Filter
          </button>
        </form>

        <CrmTaskList tasks={result.items} canManage={context.permissions.has("crm.manage")} />
        <CrmPaginationControls basePath="/admin/crm/tasks" filterParams={filterParams} pageInfo={result.pageInfo} />
      </section>
    </div>
  );
}
