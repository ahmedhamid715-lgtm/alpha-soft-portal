import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Website OS builds ZERO new QA schema — required QA is reused DIRECTLY
 * from Project QA via the engagement's linked Project (Build 27), read-
 * only here (see docs/architecture/website-development-os.md "QA").
 * Required QA is engagement-scoped, not per-site (one Project may
 * deliver several sites) — this is the SAME count `getWebsiteSiteOverview()`
 * itself already reports, never re-derived here.
 */
export function QaTab({ engagementProjectId, requiredQaCount, passedRequiredQaCount }: { engagementProjectId: string | null; requiredQaCount: number; passedRequiredQaCount: number }) {
  if (!engagementProjectId) {
    return <EmptyState icon={CheckCircle2} title="No delivery project linked yet" description="QA checks are recorded in Project Management's own QA tab. Link a project from the engagement page first." />;
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {requiredQaCount > 0 ? `${passedRequiredQaCount} of ${requiredQaCount} required QA check(s) have passed or been waived on the linked project.` : "No required QA checks recorded on the linked project yet."}
        </p>
        <Button asChild variant="outline" className="w-fit">
          <Link href={`/admin/projects/${engagementProjectId}`}>Open project QA</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
