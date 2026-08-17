import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const CATEGORY_OPTIONS = [
  "AUTHENTICATION",
  "AUTHORIZATION",
  "ORGANIZATION",
  "MEMBERSHIP",
  "INVITATION",
  "ROLE",
  "SECURITY",
  "DATA",
  "SYSTEM",
  "ADMINISTRATION",
  "COMPLIANCE",
] as const;
const OUTCOME_OPTIONS = ["SUCCESS", "FAILURE", "DENIED"] as const;

export interface AuditFiltersFormValues {
  search?: string;
  category?: string;
  outcome?: string;
  createdAfter?: string;
  createdBefore?: string;
}

/**
 * Phase 16's filter surface — a plain `<form method="get">`, not a
 * client component: every filter is already a URL search param the list
 * page itself reads server-side, so submitting reloads the page with the
 * new query string. No JS required to filter the audit log, and the
 * resulting URL is directly shareable/bookmarkable ("here's the exact
 * filtered view I'm looking at").
 *
 * Deliberately does not expose `actorUserId`/`resourceType`/`resourceId`/
 * `requestId`/`correlationId` as visible inputs — those are populated by
 * the investigation-navigation links on the event detail page (Phase
 * 18: "actor → org → resource → requestId → correlationId"), not typed
 * in by hand. The list page's own schema still accepts them.
 */
export function AuditFiltersForm({ action, values }: { action: string; values: AuditFiltersFormValues }) {
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-search">Search</Label>
        <Input id="audit-search" name="search" defaultValue={values.search ?? ""} placeholder="Action, resource, or actor…" className="w-56" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-category">Category</Label>
        <select
          id="audit-category"
          name="category"
          defaultValue={values.category ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-outcome">Outcome</Label>
        <select
          id="audit-outcome"
          name="outcome"
          defaultValue={values.outcome ?? ""}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">All outcomes</option>
          {OUTCOME_OPTIONS.map((outcome) => (
            <option key={outcome} value={outcome}>
              {outcome}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-after">From</Label>
        <Input id="audit-after" type="date" name="createdAfter" defaultValue={values.createdAfter ?? ""} className="w-40" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="audit-before">To</Label>
        <Input id="audit-before" type="date" name="createdBefore" defaultValue={values.createdBefore ?? ""} className="w-40" />
      </div>

      <Button type="submit" variant="outline">
        Apply filters
      </Button>
      {values.search || values.category || values.outcome || values.createdAfter || values.createdBefore ? (
        <Button asChild variant="ghost">
          <a href={action}>Clear</a>
        </Button>
      ) : null}
    </form>
  );
}
