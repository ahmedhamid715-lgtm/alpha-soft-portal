"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * The one "what does this number actually mean" affordance every
 * Module 15 metric tile uses (spec §24: "every important metric should
 * have... explanation/definition available"). A small, keyboard-
 * reachable info icon rather than relying on a title attribute alone
 * (never accessible to keyboard/touch users) — `TooltipTrigger` renders
 * a real, focusable `<button>`.
 */
export function MetricInfo({ definition }: { definition: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground/60 hover:text-muted-foreground" aria-label="What does this metric mean?">
          <Info className="size-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-pretty">{definition}</TooltipContent>
    </Tooltip>
  );
}
