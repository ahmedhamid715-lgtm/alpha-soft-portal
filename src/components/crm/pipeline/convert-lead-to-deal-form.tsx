"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightCircle } from "lucide-react";
import { convertLeadToDealAction } from "@/app/(protected)/admin/crm/actions";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { CrmPipeline } from "@/generated/prisma/client";

/** The one explicit lead-to-deal conversion path (see sales-pipeline.md "Lead -> deal behavior") — only ever shown for a QUALIFIED lead; the service itself re-enforces that requirement regardless of what this form sends. */
export function ConvertLeadToDealForm({ leadId, pipelines }: { leadId: string; pipelines: CrmPipeline[] }) {
  const [pipelineId, setPipelineId] = useState(pipelines.find((p) => p.isDefault)?.id ?? pipelines[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (pipelines.length === 0) {
    return <p className="text-sm text-muted-foreground">Configure a sales pipeline before converting a lead to a deal.</p>;
  }

  function handleConvert() {
    setError(null);
    startTransition(async () => {
      const result = await convertLeadToDealAction({ leadId, pipelineId });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) router.push(`/admin/crm/deals/${result.data.id}`);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="convert-pipeline">Pipeline</Label>
        <Select value={pipelineId} onValueChange={setPipelineId} disabled={pending}>
          <SelectTrigger id="convert-pipeline" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pipelines.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleConvert} disabled={pending || !pipelineId} className="w-fit">
        <ArrowRightCircle className="size-4" aria-hidden="true" />
        Convert to deal
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
