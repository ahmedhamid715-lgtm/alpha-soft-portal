"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmPipeline } from "@/generated/prisma/client";

export function PipelineSelector({ pipelines, selectedPipelineId }: { pipelines: CrmPipeline[]; selectedPipelineId: string }) {
  const router = useRouter();

  return (
    <Select value={selectedPipelineId} onValueChange={(id) => router.push(`/admin/crm/pipeline?pipeline=${id}`)}>
      <SelectTrigger aria-label="Pipeline" className="w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {pipelines.map((pipeline) => (
          <SelectItem key={pipeline.id} value={pipeline.id}>
            {pipeline.name}
            {pipeline.isDefault ? " (default)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
