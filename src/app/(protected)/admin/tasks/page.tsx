import type { Metadata } from "next";
import Link from "next/link";
import { ShieldAlert, ListChecks } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listGlobalTasks, getMyTaskCounts } from "@/server/services/tasks/global-task-service";
import { listAssignableUsers } from "@/server/services/crm-shared";
import { CrmPaginationControls } from "@/components/crm/pagination-controls";
import { TaskList } from "@/components/tasks/task-list";
import type { NormalizedTaskStatus, TaskSourceType } from "@/lib/tasks/types";
import type { DueWindow } from "@/lib/tasks/due-window";
import type { ProjectPriority } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Tasks" };

const STATUS_OPTIONS: NormalizedTaskStatus[] = ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETED", "CANCELLED"];
const PRIORITY_OPTIONS: ProjectPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const DUE_WINDOW_OPTIONS: DueWindow[] = ["OVERDUE", "DUE_TODAY", "UPCOMING", "NO_DUE_DATE"];
const SOURCE_OPTIONS: TaskSourceType[] = ["PROJECT_TASK", "CRM_TASK", "ONBOARDING_CHECKLIST", "ONBOARDING_REQUIREMENT", "STANDALONE_TASK"];

/**
 * The Build 28 (Task Management — Roadmap Module 22) cross-domain task
 * queue — a normalized VIEW over ProjectTask/CrmTask/onboarding
 * checklist+requirement items plus standalone `InternalTask` rows, never
 * a second copy of any of them. Two tabs cover the three-tab "My/Team/
 * All" shape the module's own architecture doc describes as equivalent:
 * "Team Tasks" already IS "All Tasks" when its own assignee filter is
 * left at "Everyone" — a third tab would just be Team Tasks with one
 * filter pre-set, which is the kind of arbitrary duplication the
 * module's own architecture explicitly warns against building.
 */
export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const context = await resolvePlatformContext();

  if (!context.permissions.has("task_management.read")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Tasks" breadcrumbs={[{ label: "Tasks" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the task_management.read permission." />
      </div>
    );
  }

  const single = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
  const multi = (v: string | string[] | undefined): string[] | undefined => {
    const raw = single(v);
    return raw ? raw.split(",").filter(Boolean) : undefined;
  };

  const canSeeTeam = context.permissions.has("task_management.team_read");
  const tab = single(sp.tab) === "team" && canSeeTeam ? "team" : "my";
  const page = Number(single(sp.page) ?? "1") || 1;
  const status = multi(sp.status) as NormalizedTaskStatus[] | undefined;
  const priority = multi(sp.priority) as ProjectPriority[] | undefined;
  // `|| undefined` — the filter form's "Any time" option submits an
  // EMPTY STRING (a real GET form always includes a selected `<option
  // value="">`'s own value, never omits the field), which `multi()`
  // above already treats as "unset" via its own `raw ? ... : undefined`
  // ternary; `single()` alone does not, and `listGlobalTasks()`'s Zod
  // schema rejects `""` for this field (not a valid enum member, not
  // `undefined`) — found live via a real E2E run, not by inspection: an
  // empty-string dueWindow crashed the page with a 400 VALIDATION_ERROR
  // the moment ANY filter form submission round-tripped through the
  // due-window select at its own untouched default value.
  const dueWindow = (single(sp.dueWindow) || undefined) as DueWindow | undefined;
  const search = single(sp.search);
  const sourceTypes = multi(sp.source) as TaskSourceType[] | undefined;
  const assigneeFilter = tab === "team" ? single(sp.assignee) : undefined; // "everyone" (default) or a specific user id

  const [result, myCounts, assignableUsers] = await Promise.all([
    listGlobalTasks({
      page,
      limit: 25,
      scope: tab === "team" ? "TEAM" : "MY",
      assignedToUserId: assigneeFilter && assigneeFilter !== "everyone" ? assigneeFilter : undefined,
      status,
      priority,
      dueWindow,
      search,
      sourceTypes,
    }),
    tab === "my" ? getMyTaskCounts() : Promise.resolve(null),
    context.permissions.has("task_management.manage") ? listAssignableUsers() : Promise.resolve([]),
  ]);

  const filterParams = new URLSearchParams();
  if (tab === "team") filterParams.set("tab", "team");
  if (status?.length) filterParams.set("status", status.join(","));
  if (priority?.length) filterParams.set("priority", priority.join(","));
  if (dueWindow) filterParams.set("dueWindow", dueWindow);
  if (search) filterParams.set("search", search);
  if (sourceTypes?.length) filterParams.set("source", sourceTypes.join(","));
  if (assigneeFilter && assigneeFilter !== "everyone") filterParams.set("assignee", assigneeFilter);

  const pageInfo = { page: result.page, limit: result.limit, totalCount: result.totalCount, hasNextPage: result.page * result.limit < result.totalCount };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Tasks"
        description="Everything assigned to you — or your team — across delivery projects, CRM, onboarding, and internal work. Each task still lives, and is still edited, in its own source."
        breadcrumbs={[{ label: "Tasks" }]}
        actions={
          context.permissions.has("task_management.manage") ? (
            <Button asChild size="sm">
              <Link href="/admin/tasks/new">New internal task</Link>
            </Button>
          ) : null
        }
      />

      {canSeeTeam ? (
        <div className="flex gap-2 border-b border-border">
          <Link
            href="/admin/tasks"
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === "my" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            My Tasks
          </Link>
          <Link
            href="/admin/tasks?tab=team"
            className={`border-b-2 px-1 pb-2 text-sm font-medium ${tab === "team" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            Team Tasks
          </Link>
        </div>
      ) : null}

      {myCounts ? (
        <div className="flex flex-wrap gap-2 text-xs">
          <CountChip label="Overdue" count={myCounts.overdue} tone="destructive" href="/admin/tasks?dueWindow=OVERDUE" />
          <CountChip label="Due today" count={myCounts.dueToday} tone="warning" href="/admin/tasks?dueWindow=DUE_TODAY" />
          <CountChip label="Upcoming" count={myCounts.upcoming} tone="info" href="/admin/tasks?dueWindow=UPCOMING" />
          <CountChip label="No due date" count={myCounts.noDueDate} tone="neutral" href="/admin/tasks?dueWindow=NO_DUE_DATE" />
          <CountChip label="Completed" count={myCounts.completed} tone="success" href="/admin/tasks?status=COMPLETED" />
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {tab === "team" ? <input type="hidden" name="tab" value="team" /> : null}
          <div className="flex flex-col gap-1">
            <label htmlFor="task-search" className="text-xs text-muted-foreground">
              Search
            </label>
            <input id="task-search" name="search" defaultValue={search ?? ""} placeholder="Title…" className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-source" className="text-xs text-muted-foreground">
              Source
            </label>
            <select id="task-source" name="source" defaultValue={sourceTypes?.[0] ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">All sources</option>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-status" className="text-xs text-muted-foreground">
              Status
            </label>
            <select id="task-status" name="status" defaultValue={status?.[0] ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-priority" className="text-xs text-muted-foreground">
              Priority
            </label>
            <select id="task-priority" name="priority" defaultValue={priority?.[0] ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">All priorities</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="task-due-window" className="text-xs text-muted-foreground">
              Due
            </label>
            <select id="task-due-window" name="dueWindow" defaultValue={dueWindow ?? ""} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
              <option value="">Any time</option>
              {DUE_WINDOW_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {w.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          {tab === "team" ? (
            <div className="flex flex-col gap-1">
              <label htmlFor="task-assignee" className="text-xs text-muted-foreground">
                Assignee
              </label>
              <select id="task-assignee" name="assignee" defaultValue={assigneeFilter ?? "everyone"} className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">
                <option value="everyone">Everyone</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="submit" className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted">
            Filter
          </button>
        </form>

        {result.items.length === 0 ? (
          <EmptyState icon={ListChecks} title="No tasks match these filters" description={tab === "my" ? "Nothing assigned to you right now." : "No tasks match this view."} />
        ) : (
          <TaskList tasks={result.items} assignableUsers={assignableUsers} />
        )}
        <CrmPaginationControls basePath="/admin/tasks" filterParams={filterParams} pageInfo={pageInfo} />
      </section>
    </div>
  );
}

function CountChip({ label, count, tone, href }: { label: string; count: number; tone: "destructive" | "warning" | "info" | "neutral" | "success"; href: string }) {
  const toneClass: Record<typeof tone, string> = {
    destructive: "border-destructive/20 bg-destructive/10 text-destructive",
    warning: "border-warning/20 bg-warning/10 text-[#8c4f06] dark:text-warning",
    info: "border-info/20 bg-info/10 text-info",
    neutral: "border-border bg-muted text-muted-foreground",
    success: "border-success/20 bg-success/10 text-success",
  };
  return (
    <Link href={href} className={`rounded-full border px-3 py-1 font-medium tabular-nums ${toneClass[tone]}`}>
      {label}: {count}
    </Link>
  );
}
