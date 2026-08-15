# Design System (Module 02)

## What this module is

Module 01 established brand tokens and wired them through shadcn/ui's
foundational primitives (Button, Input, Card, Dialog, ...). Module 02 is
the rest of the visual language: a full semantic token architecture, real
light/dark themes, the ~30 reusable composites every future module builds
its screens from (app shell, data table, command palette, charts, AI
message primitives, ...), and a `/design-system` showcase route that
demonstrates all of it with realistic enterprise mock data.

**Nothing in this module is a business feature.** `/design-system` is a
dev/internal reference route — its nav groups, mock customers, and demo
tickets are illustrative, not real Admin/Support/Customer navigation.
Modules 09/18/20/32 etc. build the real screens on top of these
primitives; this module only builds the primitives themselves.

## Token architecture

Three layers, in `src/app/globals.css`:

1. **Primitives** — raw values. Brand hex codes (`--brand-dark`,
   `--brand-primary`, `--brand-accent`, ...), the light-theme surface
   scale (`--light-bg`, `--light-surface`, `--light-surface-2`, ...),
   status hues per theme (`--status-success-light` / `-dark`, same for
   warning/info/destructive), and the validated categorical chart palette
   (`--chart-purple`, `--chart-magenta`, `--chart-teal`, `--chart-amber`,
   `--chart-rose` — identical in both themes, see "Data visualization"
   below).
2. **Semantic** — role aliases, redefined per theme in `:root` (light,
   default) and `.dark`. `--background`, `--foreground`, `--card`,
   `--surface-2`, `--primary`, `--accent`, `--success`/`--warning`/
   `--info`/`--destructive` (+ `-foreground` pairs), `--border`,
   `--link` (see "Color contrast: why `--link` exists, not `--primary`,
   for text" below), `--chart-1..5`.
3. **Component** — Tailwind v4's `@theme` block maps every semantic token
   to a `--color-*` variable, which auto-generates the utility classes
   (`bg-primary`, `text-link`, `border-success/20`, ...). Individual
   components never declare their own one-off color; if a component needs
   a shade shadcn's contract doesn't already name, that's a sign a new
   **semantic** token belongs in `globals.css`, not a hard-coded hex in
   the component.

**Rule: no hard-coded visual values in components.** Colors go through
`--color-*` tokens, radii through the `--radius-*` scale (`rounded-sm`
through `rounded-2xl`, all derived from one `--radius` primitive so
retheming later only touches one number), shadows through the 4-step
`--shadow-*` scale (`shadow-xs` → `shadow-lg`, deliberately subtle — cards
mostly rely on a border for elevation, shadow is reserved for genuinely
floating layers: popover, dropdown, dialog, drawer).

### Color semantics: why badges are tinted, not solid-fill

`StatusBadge`/`StatusDot` use a "soft" style — `bg-success/10
text-success border-success/20`, not a solid `bg-success` fill with white
text. Solid-fill status chips read as louder and more alert-fatiguing at
enterprise-dashboard density (a table with 50 rows of solid-green/red/
amber pills is exhausting; tinted pills recede until you need them). This
is also why the brief explicitly said "don't overuse purple" — brand
purple is reserved for primary actions and active states, not spread across
every status/decoration.

### Color contrast: why `--link` exists, not `--primary`, for text

`--primary` (`#8730B4`) is only **2.85:1** against the dark theme's
surface (`#140921`) — fine as a filled button background (paired with
white `--primary-foreground` text on top, 6.7:1), but it fails WCAG AA
(4.5:1) as a text color on that surface. `--link` is the token for
brand-purple **inline text** — the `link` button variant, a "click to
upload" affordance, a tinted badge's own label — and resolves differently
per theme:

| Theme | `--link` resolves to | Contrast vs. that theme's surface |
|---|---|---|
| Light | `--brand-primary` (`#8730B4`) | 6.7:1 |
| Dark | `--brand-accent` (`#BF43FF`) | 5.0:1 |

Both pass AA. **Never point a text color at `--primary` on a dark
surface** — use `--link`. This was caught by an automated accessibility
scan (axe-core via Playwright — see "Accessibility" below), not by eye;
2.85:1 doesn't look obviously broken at a glance.

## Component hierarchy

```
components/ui/*        shadcn-generated primitives (Button, Input, Dialog,
                        Sidebar, Command, Chart, ...) — installed via the
                        CLI, hand-edited only when necessary (documented
                        inline when it happens, e.g. command.tsx below).

components/layout/*     App shell composites: AppShell, AppSidebar, TopNav,
                        Breadcrumbs, PageHeader, SectionHeader. Own layout
                        and navigation *rendering*, not navigation *data* —
                        AppSidebar has zero knowledge of "admin" vs.
                        "support" vs. "customer"; it renders whatever
                        NavGroup[] it's handed (config/navigation.ts).

components/shared/*     Genuine reusable business-agnostic primitives:
                        DataTable, StatusBadge, MetricCard, EmptyState/
                        ErrorState, Combobox, DatePicker, FileUpload/
                        FilePreview, ConfirmDialog, CommandPalette,
                        ActivityTimeline, Stepper, charts (Line/Area/Bar/
                        Donut), AI message primitives, RichTextFoundation.
```

**When to create a new shared component vs. reuse one:** if two modules
would otherwise duplicate the same visual shape with different data (a
project list and a ticket list are both "a sortable, searchable, paginated
table of records" — that's one `DataTable`, not two), it belongs in
`components/shared`. If it's specific to one entity's business rules (a
"cancel subscription" flow's specific copy and side effects), it's a
page-level component in that module, built from shared primitives
(`ConfirmDialog` + that module's own submit handler), not a new shared
component.

## Naming, spacing, typography conventions

- **Spacing**: Tailwind's default scale throughout (`gap-1.5`, `px-2.5`,
  `py-6`, ...) — no custom spacing scale. Section-level rhythm is `gap-6`
  to `gap-8`; card-internal rhythm is `gap-2` to `gap-4`.
- **Typography scale** (see the showcase's Foundations section for the
  live specimen): page title `text-2xl font-semibold`, section header
  `text-lg font-semibold`, card title `text-base font-medium`, body
  `text-sm` (the default for most UI copy), secondary/muted `text-sm
  text-muted-foreground`, caption/metadata `text-xs text-muted-foreground`.
- **Icon sizing**: `size-4` is the default for inline/button icons,
  `size-3.5` for dense contexts (table sort arrows, badge dots' sibling
  icons), consistent across every composite — an icon that's `size-5` next
  to one that's `size-4` is exactly the "inconsistent icon sizing" failure
  mode the brief called out.
- **Component naming**: a component's file name matches its primary
  export (`status-badge.tsx` → `StatusBadge`), kebab-case files, PascalCase
  exports — matches the existing `components/ui` convention.

## Navigation shell

`AppShell` (`components/layout/app-shell.tsx`) composes
`SidebarProvider` + `AppSidebar` + `TopNav` + content region. It takes
`navGroups: NavGroup[]` and has no authorization logic — Module 05 (RBAC)
decides which nav items a given user sees; this module only renders
whatever it's handed. `NavItem` (`config/navigation.ts`) supports one
level of nesting (`children`) rendered as a collapsible group, and a
`badge` field for unread/count indicators.

**`@container`, not just `sm:`/`lg:`, for content inside the shell.** The
sidebar is fixed-width and its own state (expanded/collapsed/off-canvas)
isn't reflected in the viewport width. A grid keyed to viewport
breakpoints can decide there's room for 5 columns because the *viewport*
is 834px wide, when the sidebar has actually left only ~510px of content
width — the grid overflows and the whole page gets a horizontal
scrollbar. `AppShell`'s content wrapper carries `@container`; any content
grid that needs to respond to available width (not raw viewport width)
uses `@sm:`/`@lg:`/`@2xl:`/etc. instead. This was a real bug, caught by
screenshotting the tablet breakpoint, not by reasoning about it — the
`/design-system` page's grids were originally on `sm:`/`lg:` and visibly
overflowed at 834px.

## Data table

`DataTable` (`components/shared/data-table.tsx`) is built on **TanStack
Table v9**, a complete API rewrite from v8 (`useTable`, not
`useReactTable`; explicit `tableFeatures({...})` registration; a column
helper bound to that concrete features object). Two rules for anyone
adding a table:

1. Build columns with `createDataTableColumnHelper<TRow>()`
   (`data-table.tsx`), never a bare TanStack `createColumnHelper` — v9
   types columns against the specific `dataTableFeatures` object, and a
   column built without it won't type-check against `DataTable`'s
   `columns` prop.
2. Don't reinvent sort/filter/pagination per module. `DataTable` owns all
   three internally (global search box, click-header-to-sort, Previous/
   Next pagination) — pass `columns`/`data` in, everything else is free.

## Data visualization

Chart primitives (`components/shared/charts.tsx`) wrap recharts via
shadcn's `chart.tsx`, following the **dataviz skill**'s methodology: one
axis (never dual-axis), a legend whenever there's more than one series, a
fixed categorical hue order, tooltips always on. The five-color
categorical palette (`--chart-1` through `--chart-5` → purple/magenta/
teal/amber/rose) was chosen by running `validate_palette.js` against
*both* theme surfaces simultaneously — it passes the lightness band,
chroma floor, and CVD-separation checks, with one WARN (brand-primary at
2.85:1 against the dark surface) that obligates visible labels rather
than color-only identification. Every chart component already renders a
tooltip and (for 2+ series) a legend by default, so that obligation is
met structurally, not left to each call site to remember.

**Donut/pie `ChartConfig` keys must equal the data's actual field
values, and must be valid CSS custom-idents.** Unlike Bar/Line/Area
(where a `ChartConfig` key matches the series' `dataKey`), shadcn's
`ChartLegendContent`/`ChartTooltipContent` resolve a *slice's* label by
looking up the data row's `nameKey` **value** in the config — so for
`{ service: "SEO", count: 34 }` with `nameKey="service"`, the config needs
a `SEO` key, not a `service` key. Those same keys get embedded verbatim
as CSS custom-property names in shadcn's internal `ChartStyle`
(`--color-${key}`) — a key containing a space (`"Website Dev"`) produces
an invalid CSS declaration that the browser silently drops, leaving that
slice **unfilled and invisible** with no console error. This was a real
bug (only 2 of 5 donut slices rendered, caught by an actual screenshot,
not code review) — fixed by using kebab-case data values (`"website-dev"`)
with the human-readable text in `label` instead, which is what the legend
and tooltip actually render.

## Accessibility

Target: WCAG 2.2 AA where practical, verified with **axe-core via
Playwright** (`@axe-core/playwright`), not just built-in-and-hoped —
across light/dark, desktop/tablet/mobile, and every interactive
overlay (dialog, drawer, confirm dialog, combobox, date picker, command
palette) opened. Current state: **zero violations** across all of those.
Getting there found several real, non-obvious bugs worth knowing about
before adding new components:

- **`role="combobox"` doesn't get an accessible name from its visible
  text.** Unlike a plain `<button>`, `combobox` isn't in ARIA's
  name-from-content role list — `Combobox`'s trigger needs an explicit
  `aria-label` even though the placeholder/selection text is visibly
  right there (axe: `button-name`).
- **Radix `Popover.Content` renders `role="dialog"` internally** and
  needs a name too — `Combobox` and `DatePicker`'s `PopoverContent` both
  pass `aria-label` for this reason (axe: `aria-dialog-name`). Any new
  Popover-based component needs the same.
- **A `<ul>`/`SidebarMenu` can only contain `<li>`s directly.** The
  original nested-nav markup wrapped `SidebarMenuItem` (an `<li>`) *inside*
  `Collapsible` (a `<div>`), putting a `<div>` directly under the `<ul>`.
  Fixed by nesting the other way — `Collapsible` inside the `<li>`, not
  around it (axe: `list`/`listitem`).
- **An `<input>` nested inside a `role="button"` container is a real
  nested-interactive violation**, even with `tabIndex={-1}` and
  `aria-hidden`. `FileUpload`'s hidden file input is a **sibling** of the
  clickable dropzone, not a child of it — `inputRef.current?.click()`
  works identically from that position.
- **The sidebar wasn't exposed as a `nav` landmark at all** — every nav
  item, group label, and badge was "content not contained by a landmark"
  (axe: `region`, 7 instances at once). Fixed with `role="navigation"
  aria-label="Primary"` on the sidebar's actual content panel
  (`ui/sidebar.tsx`, both the desktop and mobile-sheet variants).
- **A dedicated `<main>` only belongs once per page.** `AppShell`'s
  content wrapper was itself a second `<main>`, nested inside
  `SidebarInset`'s own `<main>` (axe: `landmark-no-duplicate-main` /
  `landmark-main-is-top-level`). It's a plain `<div>` now.
- Non-text controls (a bare `Progress` bar, the `RichTextFoundation`
  `contentEditable` region) need an explicit `aria-label` — there's no
  implicit one the way a labeled `<input>` gets from `<label for>`.

Beyond axe, a manual pass confirmed: visible focus rings on every
interactive element (Tailwind's `focus-visible:ring-*`, consistently
applied via each primitive's base classes, not per-instance), full
keyboard reachability of the sidebar/top nav/command palette/dialogs, and
`prefers-reduced-motion` support (see "Motion" below).

## Motion

Deliberately restrained — no animated gradients, no glow effects, no
motion beyond what orients the user. Two layers:

1. **Radix-driven overlays** (dialog, drawer/sheet, dropdown, popover,
   select, tooltip) all share shadcn's own `data-[state=]` +
   `animate-in`/`animate-out` convention at a consistent ~200ms, not a
   parallel custom scale.
2. **Everything else** uses Tailwind's own `transition-colors` /
   `transition-transform` / `duration-*` / `ease-*` utilities directly at
   the call site (a collapsible nav chevron's rotation, a hover state, a
   file-upload progress bar) — there's no custom-named motion scale to
   keep in sync with Tailwind's.

`globals.css` has one global `@media (prefers-reduced-motion: reduce)`
rule collapsing every animation/transition's duration to near-zero and
disabling smooth scroll — verified with Playwright's `reducedMotion:
'reduce'` context emulation, not just present-in-the-CSS.

## Two real bugs this module found and fixed (not design-system-specific, but discovered here)

Worth recording because both were silent — no build error, no lint
error, only found via actual runtime verification (Playwright), and both
would have shipped broken to every future module that uses these
primitives:

- **The command palette crashed on open.** `CommandDialog`
  (`components/ui/command.tsx`) rendered `CommandInput`/`CommandList`
  directly inside `DialogContent` without cmdk's own `<Command>` root
  provider — those child components read their store via that provider's
  context, which was `undefined`, throwing `Cannot read properties of
  undefined (reading 'subscribe')` and taking down the whole React tree
  the instant ⌘K was pressed. Fixed by wrapping `{children}` in
  `<Command>`.
- **`ActivityTimeline` had a hydration mismatch.** The showcase's demo
  data built timestamps as `new Date(Date.now() - N)` at module scope —
  since this is a client component, that module evaluates once
  server-side (render) and again client-side (hydrate), at two different
  real moments, producing two different `Date` objects and a genuine
  `<time dateTime>` mismatch React can't patch up. Fixed at both layers:
  demo data now uses fixed ISO literals (identical every evaluation), and
  `ActivityTimeline` itself now defers its *relative-time text*
  computation (which reads `Date.now()` internally) to a post-mount
  render pass via `useSyncExternalStore`, rendering a deterministic,
  prop-only fallback for the SSR-matched first paint — so a real caller
  passing a genuinely-dynamic timestamp won't hit the same class of bug.

## Responsive strategy

Not "the same layout, smaller" — deliberate per-pattern strategies:

- **Grids**: `@container`-based breakpoints (see "Navigation shell"
  above), collapsing from up to 5 columns down to 1-2 as available
  content width shrinks.
- **Tables**: `DataTable`'s wrapper has its own `overflow-x-auto` — a
  wide, dense table scrolls horizontally *within its own bounded card* on
  narrow viewports, never breaking the page out to a horizontal
  scrollbar. This is intentional (a 6-column project table is
  legitimately wide; hiding columns would lose information a user might
  need) — verified by checking `document.documentElement.scrollWidth`
  stays equal to `clientWidth` at 390px even with the table visible.
- **Sidebar**: off-canvas (Sheet-based slide-over) below the `md`
  breakpoint, expanded-or-icon-rail above it — inherited from shadcn's
  Sidebar primitive, not custom.
- **Dialogs vs. drawers**: both exist (`Dialog`, `Sheet`) as distinct
  primitives — a module picks a `Sheet` (slide-over drawer) over a
  `Dialog` when the content is inherently a side panel (filters, a record
  preview) rather than a centered decision, especially on mobile where a
  full dialog can feel like a dead end.

Verified with actual Playwright screenshots at desktop (1440px), tablet
(834px), and mobile (390px), each in both themes — not just written and
assumed correct.

## Showcase route

`/design-system` (`src/app/design-system/`) — dev/internal only, no real
business logic or entities. Demonstrates every primitive in its
default/hover/focus/disabled/loading/error/empty states with realistic
mock data (a dense project table, financial metric cards, a ticket-volume
chart, an AI conversation, a multi-step form). It exists so a future
module author can see the real, current rendering of every shared
component in one place instead of reverse-engineering it from another
module's page.

## Testing

Reusable-behavior tests live in `tests/unit/components/*.test.tsx`,
using `@testing-library/react` + `jsdom` (opted in per-file via a
`// @vitest-environment jsdom` docblock — the existing plain-logic suite
stays on the faster `node` environment by default). Coverage: `StatusBadge`
variant→class mapping and the dot-always-present rule, `ConfirmDialog`'s
confirm/cancel/loading-disables-both behavior, `Combobox`'s accessible
name and selection/toggle-off behavior, `ActivityTimeline`'s
prop-only `dateTime` attribute, `DataTable`'s search/sort/pagination/
empty/loading states, and `AppSidebar`'s active-state matching and
valid `<ul>`/`<li>` nesting for nested nav groups.

Three jsdom gaps needed polyfilling in `tests/setup/jsdom-matchers.ts`
(`window.matchMedia`, `ResizeObserver`, `Element.prototype.scrollIntoView`
— none of which jsdom implements, all of which real components in this
module depend on) alongside RTL's `cleanup()`, which isn't automatic
unless `test.globals: true` is set (it isn't, to keep `describe`/`it`
explicit-import throughout the suite) — without it, `render()` calls
leak DOM across tests within a file.
