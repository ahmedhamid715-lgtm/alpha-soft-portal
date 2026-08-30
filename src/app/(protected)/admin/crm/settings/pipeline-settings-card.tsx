"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, Plus, Archive, ArchiveRestore, Star } from "lucide-react";
import { archivePipelineAction, reactivatePipelineAction, updatePipelineAction, createStageAction, moveStageAction, archiveStageAction } from "../actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmPipeline, CrmPipelineStage } from "@/generated/prisma/client";

/**
 * One pipeline's own settings — name/default/archive controls plus its
 * full stage list with up/down reorder buttons. The buttons ARE the
 * primary reorder interface here (no drag on the settings page at
 * all) — the board's own drag-and-drop (`stage-column.tsx`) only moves
 * DEALS between stages, never reorders the stages themselves.
 */
export function PipelineSettingsCard({ pipeline, stages }: { pipeline: CrmPipeline; stages: CrmPipelineStage[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [newStageName, setNewStageName] = useState("");

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  const activeStages = stages.filter((s) => s.status === "ACTIVE").sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{pipeline.name}</span>
            {pipeline.isDefault ? <StatusBadge status="primary">Default</StatusBadge> : null}
            <StatusBadge status={pipeline.status === "ACTIVE" ? "success" : "neutral"}>{pipeline.status}</StatusBadge>
          </div>
          <div className="flex items-center gap-2">
            {!pipeline.isDefault && pipeline.status === "ACTIVE" ? (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => updatePipelineAction({ pipelineId: pipeline.id, isDefault: true }))}>
                <Star className="size-4" aria-hidden="true" />
                Make default
              </Button>
            ) : null}
            {pipeline.status === "ACTIVE" ? (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => archivePipelineAction({ pipelineId: pipeline.id }))}>
                <Archive className="size-4" aria-hidden="true" />
                Archive
              </Button>
            ) : (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => reactivatePipelineAction({ pipelineId: pipeline.id }))}>
                <ArchiveRestore className="size-4" aria-hidden="true" />
                Reactivate
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {activeStages.map((stage, index) => (
            <div key={stage.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex flex-col">
                  <Button size="icon-xs" variant="ghost" disabled={pending || index === 0} aria-label={`Move ${stage.name} earlier`} onClick={() => run(() => moveStageAction({ stageId: stage.id, targetIndex: index - 1 }))}>
                    <ArrowUp className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button size="icon-xs" variant="ghost" disabled={pending || index === activeStages.length - 1} aria-label={`Move ${stage.name} later`} onClick={() => run(() => moveStageAction({ stageId: stage.id, targetIndex: index + 1 }))}>
                    <ArrowDown className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{stage.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {stage.isWon ? "Won stage" : stage.isLost ? "Lost stage" : stage.defaultProbability !== null ? `Default probability ${stage.defaultProbability}%` : "No default probability"}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => archiveStageAction({ stageId: stage.id }))}>
                Archive
              </Button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`new-stage-${pipeline.id}`}>New stage</Label>
            <Input id={`new-stage-${pipeline.id}`} value={newStageName} onChange={(e) => setNewStageName(e.target.value)} disabled={pending} maxLength={200} className="w-56" />
          </div>
          <Button
            size="sm"
            disabled={pending || !newStageName.trim()}
            onClick={() => {
              const name = newStageName;
              setNewStageName("");
              run(() => createStageAction({ pipelineId: pipeline.id, name }));
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            Add stage
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
