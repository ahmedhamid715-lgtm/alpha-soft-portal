"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Plus,
  Sparkles,
  Ticket as TicketIcon,
  UserPlus,
} from "lucide-react"

import { PageHeader } from "@/components/layout/page-header"
import { SectionHeader } from "@/components/layout/section-header"
import { MetricCard, MetricCardSkeleton } from "@/components/shared/metric-card"
import { StatusBadge, StatusDot } from "@/components/shared/status-badge"
import { DataTable, createDataTableColumnHelper } from "@/components/shared/data-table"
import { EmptyState, ErrorState } from "@/components/shared/empty-state"
import { CardGridSkeleton, ListSkeleton, TableSkeleton } from "@/components/shared/loading-patterns"
import { Combobox } from "@/components/shared/combobox"
import { DatePicker } from "@/components/shared/date-picker"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { FileUpload } from "@/components/shared/file-upload"
import { FilePreview, type FilePreviewItem } from "@/components/shared/file-preview"
import { RichTextFoundation } from "@/components/shared/rich-text-foundation"
import { ActivityTimeline, type TimelineEntry } from "@/components/shared/activity-timeline"
import { Stepper } from "@/components/shared/stepper"
import { AreaChart, BarChart, DonutChart, LineChart, type ChartConfig } from "@/components/shared/charts"
import { ChatMessage, ChatThread, AIThinkingIndicator, AIActionCard } from "@/components/shared/ai-chat"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Sample data — visual examples only. Nothing here is a real business
// entity or database record (spec requirement).
// ---------------------------------------------------------------------------

interface DemoProject {
  id: string
  name: string
  customer: string
  status: "on_track" | "at_risk" | "delayed" | "completed"
  owner: string
  dueDate: string
  budget: string
}

const demoProjects: DemoProject[] = [
  { id: "PRJ-101", name: "Website Redesign", customer: "Acme Co", status: "on_track", owner: "Sarah Chen", dueDate: "2026-09-12", budget: "$18,500" },
  { id: "PRJ-102", name: "GBP Optimization", customer: "Blue Harbor Dental", status: "completed", owner: "Marcus Lee", dueDate: "2026-07-01", budget: "$3,200" },
  { id: "PRJ-103", name: "E-commerce Migration", customer: "Northwind Traders", status: "at_risk", owner: "Priya Nair", dueDate: "2026-08-30", budget: "$42,000" },
  { id: "PRJ-104", name: "SEO Sprint — Q3", customer: "Fenwick Legal", status: "on_track", owner: "Sarah Chen", dueDate: "2026-09-05", budget: "$9,800" },
  { id: "PRJ-105", name: "GHL Automation Build", customer: "Ridgeline Fitness", status: "delayed", owner: "Marcus Lee", dueDate: "2026-08-15", budget: "$6,400" },
  { id: "PRJ-106", name: "Brand Refresh", customer: "Acme Co", status: "on_track", owner: "Priya Nair", dueDate: "2026-10-01", budget: "$14,000" },
  { id: "PRJ-107", name: "Local SEO Citations", customer: "Northwind Traders", status: "completed", owner: "Sarah Chen", dueDate: "2026-06-20", budget: "$2,100" },
]

const projectStatusMeta: Record<DemoProject["status"], { label: string; status: "success" | "warning" | "destructive" | "info" }> = {
  on_track: { label: "On track", status: "info" },
  at_risk: { label: "At risk", status: "warning" },
  delayed: { label: "Delayed", status: "destructive" },
  completed: { label: "Completed", status: "success" },
}

const columnHelper = createDataTableColumnHelper<DemoProject>()
const projectColumns = [
  columnHelper.accessor("name", {
    header: "Project",
    cell: (info) => (
      <div className="flex flex-col">
        <span className="font-medium">{info.getValue()}</span>
        <span className="text-xs text-muted-foreground">{info.row.original.id}</span>
      </div>
    ),
  }),
  columnHelper.accessor("customer", { header: "Customer" }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const meta = projectStatusMeta[info.getValue()]
      return <StatusBadge status={meta.status}>{meta.label}</StatusBadge>
    },
  }),
  columnHelper.accessor("owner", { header: "Owner" }),
  columnHelper.accessor("dueDate", { header: "Due" }),
  columnHelper.accessor("budget", { header: "Budget" }),
]

const revenueData = [
  { month: "Mar", revenue: 42500, expenses: 28100 },
  { month: "Apr", revenue: 46800, expenses: 29400 },
  { month: "May", revenue: 45200, expenses: 30800 },
  { month: "Jun", revenue: 51900, expenses: 31200 },
  { month: "Jul", revenue: 55400, expenses: 32600 },
  { month: "Aug", revenue: 61200, expenses: 33900 },
]
const revenueConfig = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  expenses: { label: "Expenses", color: "var(--chart-3)" },
} satisfies ChartConfig

const ticketVolumeData = [
  { day: "Mon", opened: 14, resolved: 11 },
  { day: "Tue", opened: 18, resolved: 15 },
  { day: "Wed", opened: 9, resolved: 13 },
  { day: "Thu", opened: 21, resolved: 16 },
  { day: "Fri", opened: 12, resolved: 14 },
]
const ticketConfig = {
  opened: { label: "Opened", color: "var(--chart-2)" },
  resolved: { label: "Resolved", color: "var(--chart-4)" },
} satisfies ChartConfig

const serviceMixData = [
  { service: "seo", count: 34 },
  { service: "website-dev", count: 21 },
  { service: "ghl-automation", count: 15 },
  { service: "creative", count: 9 },
  { service: "ecommerce", count: 7 },
]
// Keys must match the actual values in serviceMixData's `service` field —
// ChartLegendContent resolves a Pie/Donut slice's label by looking up the
// data row's nameKey *value* in this config, not the field name (unlike
// Bar/Line/Area, where config keys match the series dataKey instead). Those
// keys are also used verbatim as CSS custom-property names in shadcn's
// ChartStyle (`--color-${key}`), so they must be valid CSS custom-idents —
// a space (e.g. "Website Dev") produces an invalid declaration that the
// browser silently drops, leaving that slice unfilled (invisible against
// the dark surface). Data values stay as safe kebab-case slugs; the
// human-readable text lives only in `label`, which is what the legend and
// tooltip actually render.
const serviceMixConfig = {
  seo: { label: "SEO", color: "var(--chart-1)" },
  "website-dev": { label: "Website Dev", color: "var(--chart-2)" },
  "ghl-automation": { label: "GHL Automation", color: "var(--chart-3)" },
  creative: { label: "Creative", color: "var(--chart-4)" },
  ecommerce: { label: "E-commerce", color: "var(--chart-5)" },
} satisfies ChartConfig

// Fixed ISO timestamps, not `Date.now() - N` — this module evaluates once
// server-side (render) and again client-side (hydrate), at two different
// real moments; `Date.now()`-derived values would produce two different
// Date objects and a genuine hydration mismatch on the <time dateTime>
// attribute (React: "Variable input such as Date.now() ... which changes
// each time it's called"). Fixed literals are identical both times. Real
// usage pulls actual stored timestamps from the database, which are
// already stable for the same reason.
const activityEntries: TimelineEntry[] = [
  { id: "1", actor: { name: "Sarah Chen" }, action: "moved Website Redesign to On Track", timestamp: new Date("2026-08-15T13:48:00Z") },
  { id: "2", actor: { name: "Marcus Lee" }, action: "uploaded 3 files to Q3 SEO Sprint", timestamp: new Date("2026-08-15T12:00:00Z") },
  {
    id: "3",
    action: "Invoice #1042 was marked paid",
    icon: FileText,
    timestamp: new Date("2026-08-15T09:00:00Z"),
    detail: (
      <p className="rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
        status: <span className="line-through">pending</span> → <span className="font-medium text-foreground">paid</span>
      </p>
    ),
  },
  { id: "4", actor: { name: "Priya Nair" }, action: "assigned Ticket #318 to Support", timestamp: new Date("2026-08-14T12:00:00Z") },
]

const filePreviewSample: FilePreviewItem[] = [
  { id: "f1", name: "brand-guidelines-v3.pdf", size: 2_400_000, type: "application/pdf" },
  { id: "f2", name: "homepage-mockup.png", size: 5_100_000, type: "image/png", progress: 64 },
  { id: "f3", name: "q3-keywords.xlsx", size: 380_000, type: "application/vnd.ms-excel" },
]

const comboboxOptions = [
  { value: "acme", label: "Acme Co" },
  { value: "blue-harbor", label: "Blue Harbor Dental" },
  { value: "northwind", label: "Northwind Traders" },
  { value: "fenwick", label: "Fenwick Legal" },
  { value: "ridgeline", label: "Ridgeline Fitness" },
]

const colorTokens: { name: string; className: string; textOn?: "light" | "dark" }[] = [
  { name: "background", className: "bg-background border border-border" },
  { name: "surface (card)", className: "bg-card border border-border" },
  { name: "surface-2", className: "bg-surface-2 border border-border" },
  { name: "primary", className: "bg-primary", textOn: "light" },
  { name: "accent", className: "bg-accent", textOn: "dark" },
  { name: "success", className: "bg-success", textOn: "dark" },
  { name: "warning", className: "bg-warning", textOn: "dark" },
  { name: "destructive", className: "bg-destructive", textOn: "light" },
  { name: "info", className: "bg-info", textOn: "dark" },
  { name: "muted", className: "bg-muted border border-border" },
]

// ---------------------------------------------------------------------------

export default function DesignSystemPage() {
  const [tableState, setTableState] = useState<"loaded" | "loading" | "empty" | "error">("loaded")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [richText, setRichText] = useState("<p>Draft notes for the client kickoff call…</p>")
  const [comboboxValue, setComboboxValue] = useState("")
  const [dateValue, setDateValue] = useState<Date>()

  return (
    <div className="flex flex-col gap-16 pb-24">
      <PageHeader
        title="Alpha OS Design System"
        description="Every reusable primitive and composite in Module 02 — one visual language for Admin, Support, Customer, CRM, Projects, SEO, AI, Finance, and Analytics. Internal reference only."
        breadcrumbs={[{ label: "Alpha OS", href: "/design-system" }, { label: "Design System" }]}
        actions={
          <>
            <Button variant="outline" size="sm">
              <FileText className="size-4" /> View docs
            </Button>
            <Button size="sm">
              <Plus className="size-4" /> New
            </Button>
          </>
        }
      />

      {/* ================= FOUNDATIONS ================= */}
      <section id="foundations" className="flex flex-col gap-8 scroll-mt-20">
        <SectionHeader title="Foundations" description="Color, typography, spacing, radius — the tokens everything else is built from." />

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Semantic color tokens</h3>
          {/* @container variants (see app-shell.tsx) — sized against space next to the sidebar, not raw viewport width. */}
          <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-5">
            {colorTokens.map((token) => (
              <div key={token.name} className="flex flex-col gap-2">
                <div className={`h-16 rounded-lg ${token.className}`} />
                <span className="font-mono text-xs text-muted-foreground">{token.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Typography scale</h3>
          <div className="flex flex-col gap-3 rounded-lg border border-border p-6">
            <p className="text-2xl font-semibold tracking-tight">Page title — text-2xl / font-semibold</p>
            <p className="text-lg font-semibold">Section header — text-lg / font-semibold</p>
            <p className="text-base font-medium">Card title — text-base / font-medium</p>
            <p className="text-sm">Body text — text-sm (the default for most UI copy)</p>
            <p className="text-sm text-muted-foreground">Secondary / muted text — text-sm text-muted-foreground</p>
            <p className="text-xs text-muted-foreground">Caption / metadata — text-xs text-muted-foreground</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Radius scale</h3>
          {/* Literal classes, not `rounded-${size}` — Tailwind's build-time
              scanner needs complete class strings present in the source to
              generate them; a template-literal-constructed name silently
              produces no CSS. */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-sm border-2 border-primary bg-primary/10" />
              <span className="font-mono text-xs text-muted-foreground">radius-sm</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-md border-2 border-primary bg-primary/10" />
              <span className="font-mono text-xs text-muted-foreground">radius-md</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-lg border-2 border-primary bg-primary/10" />
              <span className="font-mono text-xs text-muted-foreground">radius-lg</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-xl border-2 border-primary bg-primary/10" />
              <span className="font-mono text-xs text-muted-foreground">radius-xl</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-2xl border-2 border-primary bg-primary/10" />
              <span className="font-mono text-xs text-muted-foreground">radius-2xl</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Shadow scale (used sparingly — see docs)</h3>
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-lg bg-card shadow-xs" />
              <span className="font-mono text-xs text-muted-foreground">shadow-xs</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-lg bg-card shadow-sm" />
              <span className="font-mono text-xs text-muted-foreground">shadow-sm</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-lg bg-card shadow-md" />
              <span className="font-mono text-xs text-muted-foreground">shadow-md</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <div className="size-16 rounded-lg bg-card shadow-lg" />
              <span className="font-mono text-xs text-muted-foreground">shadow-lg</span>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ================= BUTTONS, INPUTS & FORM CONTROLS ================= */}
      <section id="forms" className="flex flex-col gap-8 scroll-mt-20">
        <SectionHeader title="Buttons & form controls" description="Default, hover (via focus-visible ring below), disabled, and loading states." />

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-muted-foreground">Buttons</h3>
          <div className="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
            <Button disabled>
              <Loader2 className="animate-spin" /> Loading
            </Button>
            <Button className="ring-3 ring-ring/50 border-ring" variant="outline">
              Focus state (simulated)
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Add">
              <Plus />
            </Button>
          </div>
        </div>

        <div className="grid gap-6 @sm:grid-cols-2 @lg:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-input">Company name</Label>
            <Input id="demo-input" placeholder="Acme Co" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-input-error">Email (error state)</Label>
            <Input id="demo-input-error" defaultValue="not-an-email" aria-invalid="true" />
            <p className="text-xs text-destructive">Enter a valid email address.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-input-disabled">Disabled</Label>
            <Input id="demo-input-disabled" placeholder="Not editable" disabled />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Assigned customer (Combobox)</Label>
            <Combobox options={comboboxOptions} value={comboboxValue} onChange={setComboboxValue} placeholder="Select a customer…" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Due date (Date picker)</Label>
            <DatePicker value={dateValue} onChange={setDateValue} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-select">Priority (Select)</Label>
            <Select defaultValue="medium">
              <SelectTrigger id="demo-select" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="urgent">Urgent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-6 @sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="demo-textarea">Notes</Label>
            <Textarea id="demo-textarea" placeholder="Add context for the team…" rows={3} />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox id="demo-checkbox" defaultChecked />
              <Label htmlFor="demo-checkbox">Notify assignee by email</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="demo-switch" defaultChecked />
              <Label htmlFor="demo-switch">Enable AI suggestions</Label>
            </div>
            <RadioGroup defaultValue="weekly" className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="daily" id="r-daily" />
                <Label htmlFor="r-daily">Daily</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="weekly" id="r-weekly" />
                <Label htmlFor="r-weekly">Weekly</Label>
              </div>
            </RadioGroup>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Rich text foundation</Label>
          <RichTextFoundation
            value={richText}
            onChange={setRichText}
            placeholder="Write something…"
            aria-label="Notes"
            className="max-w-xl"
          />
        </div>
      </section>

      <Separator />

      {/* ================= BADGES & STATUS ================= */}
      <section className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader title="Badges & status indicators" description="Status is always dot + label, never color alone." />
        <div className="flex flex-wrap items-center gap-3">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status="success">Active</StatusBadge>
          <StatusBadge status="warning">At risk</StatusBadge>
          <StatusBadge status="destructive">Overdue</StatusBadge>
          <StatusBadge status="info">In review</StatusBadge>
          <StatusBadge status="primary">Featured</StatusBadge>
          <StatusBadge status="neutral">Archived</StatusBadge>
        </div>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
          <StatusDot status="success">Online</StatusDot>
          <StatusDot status="destructive">Offline</StatusDot>
          <StatusDot status="warning">Degraded</StatusDot>
        </div>
      </section>

      <Separator />

      {/* ================= METRICS & CARDS ================= */}
      <section className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader title="Metric cards" description="The dashboard number tile, and its loading state." />
        <div className="grid gap-4 @sm:grid-cols-2 @2xl:grid-cols-4">
          <MetricCard label="MRR" value="$61,200" change="+10.5%" trend="up" icon={CheckCircle2} />
          <MetricCard label="Open tickets" value="18" change="+3 today" trend="down" icon={TicketIcon} />
          <MetricCard label="Active projects" value="27" change="+2 this week" trend="up" icon={Building2} />
          <MetricCard label="New customers" value="6" change="No change" trend="neutral" icon={UserPlus} />
        </div>
        <h3 className="text-sm font-medium text-muted-foreground">Loading state</h3>
        <div className="grid gap-4 @sm:grid-cols-2 @2xl:grid-cols-4">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
        </div>
      </section>

      <Separator />

      {/* ================= DATA TABLE ================= */}
      <section id="data" className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader
          title="Enterprise data table"
          description="Sortable columns, global search, pagination. Toggle the states below."
          actions={
            <div className="flex gap-2">
              {(["loaded", "loading", "empty", "error"] as const).map((state) => (
                <Button
                  key={state}
                  size="sm"
                  variant={tableState === state ? "default" : "outline"}
                  onClick={() => setTableState(state)}
                >
                  {state[0].toUpperCase() + state.slice(1)}
                </Button>
              ))}
            </div>
          }
        />
        {tableState === "error" ? (
          <ErrorState
            title="Couldn't load projects"
            description="The request failed. This is a visual example — no real request was made."
            action={
              <Button size="sm" variant="outline" onClick={() => setTableState("loaded")}>
                Retry
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={projectColumns}
            data={tableState === "empty" ? [] : demoProjects}
            loading={tableState === "loading"}
            searchPlaceholder="Search projects…"
            emptyTitle="No projects yet"
            emptyDescription="Projects created by any module will appear here."
            pageSize={5}
          />
        )}
      </section>

      <Separator />

      {/* ================= NAVIGATION EXTRAS ================= */}
      <section className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader title="Tabs & pagination context" description="Secondary navigation patterns used inside a page." />
        <Tabs defaultValue="overview" className="w-full max-w-xl">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-sm text-muted-foreground">
            Tab panels swap content without a page navigation — used for record detail views (a project, a ticket, a customer).
          </TabsContent>
          <TabsContent value="activity" className="text-sm text-muted-foreground">
            Second panel — content is only mounted for the active tab.
          </TabsContent>
          <TabsContent value="files" className="text-sm text-muted-foreground">
            Third panel.
          </TabsContent>
        </Tabs>
      </section>

      <Separator />

      {/* ================= FEEDBACK ================= */}
      <section id="feedback" className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader title="Feedback & overlays" description="Alerts, toasts, dialogs, drawers, tooltips, confirmation, skeletons, empty/error states." />

        <div className="grid gap-3 @lg:grid-cols-2">
          <Alert>
            <Info />
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>This is an informational alert — used for non-blocking context.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Something needs attention</AlertTitle>
            <AlertDescription>This is a destructive alert — reserved for errors that block progress.</AlertDescription>
          </Alert>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => toast.success("Project updated", { description: "Website Redesign is now On Track." })}>
            Trigger success toast
          </Button>
          <Button variant="outline" onClick={() => toast.error("Couldn't save changes", { description: "Try again in a moment." })}>
            Trigger error toast
          </Button>
          <Button variant="outline" onClick={() => toast("Reminder", { description: "Kickoff call in 15 minutes." })}>
            Trigger default toast
          </Button>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline">Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create project</DialogTitle>
                <DialogDescription>This is a standard dialog — modal, centered, dismissible.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dialog-name">Project name</Label>
                <Input id="dialog-name" placeholder="Website Redesign" />
              </div>
              <DialogFooter>
                <Button variant="outline">Cancel</Button>
                <Button>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline">Open drawer</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Ticket #318</SheetTitle>
                <SheetDescription>Drawers work as a mobile-friendly alternative to a dialog — full detail panels, filters, etc.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>

          <Button variant="outline" onClick={() => setConfirmOpen(true)}>
            Open confirmation dialog
          </Button>
          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Delete this project?"
            description="This action can't be undone. All associated tasks and files will be removed."
            confirmLabel="Delete project"
            variant="destructive"
            onConfirm={() => setConfirmOpen(false)}
          />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline">Hover for tooltip</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltips use focus-visible too — tab to this button.</TooltipContent>
          </Tooltip>
        </div>

        <div className="grid gap-6 @lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Empty state</h3>
            <EmptyState title="No support tickets" description="New tickets from customers will show up here." action={<Button size="sm">New ticket</Button>} />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">Error state</h3>
            <ErrorState title="Failed to load" description="Something went wrong loading this panel." action={<Button size="sm" variant="outline">Retry</Button>} />
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium text-muted-foreground">Loading skeleton patterns</h3>
          <Tabs defaultValue="table-skel">
            <TabsList>
              <TabsTrigger value="table-skel">Table</TabsTrigger>
              <TabsTrigger value="card-skel">Card grid</TabsTrigger>
              <TabsTrigger value="list-skel">List</TabsTrigger>
            </TabsList>
            <TabsContent value="table-skel">
              <TableSkeleton rows={4} columns={4} />
            </TabsContent>
            <TabsContent value="card-skel">
              <CardGridSkeleton count={3} />
            </TabsContent>
            <TabsContent value="list-skel">
              <ListSkeleton rows={4} />
            </TabsContent>
          </Tabs>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">Bare skeleton primitives</h3>
          <div className="flex items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* ================= PROGRESS, STEPPER, TIMELINE ================= */}
      <section className="flex flex-col gap-8 scroll-mt-20">
        <SectionHeader title="Progress, steps & activity" />

        <div className="flex flex-col gap-2 max-w-md">
          <h3 className="text-sm font-medium text-muted-foreground">Progress</h3>
          <Progress value={64} aria-label="Onboarding progress" />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Stepper — client onboarding</h3>
          <Stepper
            currentStep={1}
            steps={[
              { id: "intake", label: "Intake form", description: "Basic details" },
              { id: "services", label: "Select services", description: "SEO, GBP, web" },
              { id: "kickoff", label: "Kickoff call", description: "Schedule" },
              { id: "done", label: "Complete" },
            ]}
          />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Activity timeline</h3>
          <div className="max-w-lg">
            <ActivityTimeline entries={activityEntries} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">File upload & preview</h3>
          <div className="flex max-w-lg flex-col gap-3">
            <FileUpload onFilesSelected={() => {}} hint="PDF, PNG, XLSX up to 10MB" />
            {filePreviewSample.map((file) => (
              <FilePreview key={file.id} file={file} onRemove={() => {}} />
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* ================= CHARTS ================= */}
      <section id="charts" className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader title="Data visualization" description="Validated categorical palette (--chart-1..5) — see docs/architecture/design-system.md." />
        <div className="grid gap-4 @lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Revenue vs. expenses</CardTitle>
              <CardDescription>Last 6 months</CardDescription>
            </CardHeader>
            <CardContent>
              <AreaChart data={revenueData} config={revenueConfig} xKey="month" seriesKeys={["revenue", "expenses"]} className="h-64 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ticket volume</CardTitle>
              <CardDescription>This week</CardDescription>
            </CardHeader>
            <CardContent>
              <BarChart data={ticketVolumeData} config={ticketConfig} xKey="day" seriesKeys={["opened", "resolved"]} className="h-64 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">MRR trend</CardTitle>
              <CardDescription>Single series — no legend needed</CardDescription>
            </CardHeader>
            <CardContent>
              <LineChart data={revenueData} config={revenueConfig} xKey="month" seriesKeys={["revenue"]} className="h-64 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Service mix</CardTitle>
              <CardDescription>Active projects by service line</CardDescription>
            </CardHeader>
            <CardContent>
              <DonutChart data={serviceMixData} config={serviceMixConfig} dataKey="count" nameKey="service" className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* ================= AI ================= */}
      <section id="ai" className="flex flex-col gap-6 scroll-mt-20">
        <SectionHeader title="AI conversation primitives" description="Visual only — no model calls. See docs for Module 33 (AI Core) hand-off." />
        <Card className="max-w-xl">
          <CardContent>
            <ChatThread>
              <ChatMessage role="user" content="Can you summarize open tickets for Acme Co?" timestamp="10:41 AM" />
              <ChatMessage
                role="assistant"
                content="Acme Co has 2 open tickets: a billing question (Ticket #318, medium priority) and a request to adjust their GBP hours (Ticket #322, low priority). Want me to draft a reply to either?"
                timestamp="10:41 AM"
              />
              <AIThinkingIndicator />
              <AIActionCard
                title="Create a follow-up task"
                description="Based on the conversation, I can create a task for the account manager."
                details={[
                  { label: "Assignee", value: "Sarah Chen" },
                  { label: "Due", value: "Tomorrow, 5:00 PM" },
                  { label: "Related to", value: "Ticket #318" },
                ]}
                onApprove={() => toast.success("Task created")}
                onDeny={() => toast("Dismissed")}
              />
            </ChatThread>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ================= AVATARS ================= */}
      <section className="flex flex-col gap-4 scroll-mt-20">
        <SectionHeader title="Avatars" />
        <div className="flex items-center gap-3">
          <Avatar className="border border-border">
            <AvatarFallback>SC</AvatarFallback>
          </Avatar>
          <Avatar className="border border-border">
            <AvatarFallback>
              <Sparkles className="size-4" />
            </AvatarFallback>
          </Avatar>
          <div className="flex -space-x-2">
            {["SC", "ML", "PN"].map((initials) => (
              <Avatar key={initials} className="border-2 border-background">
                <AvatarFallback className="text-xs">{initials}</AvatarFallback>
              </Avatar>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
