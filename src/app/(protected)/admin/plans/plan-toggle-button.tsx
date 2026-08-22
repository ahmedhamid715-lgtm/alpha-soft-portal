"use client";

import { useActionState, useTransition } from "react";
import { togglePlanActiveAction, togglePlanPriceActiveAction, type PlanActionState } from "./actions";
import { Button } from "@/components/ui/button";

const initialState: PlanActionState = {};

export function PlanToggleButton({ id, active, kind }: { id: string; active: boolean; kind: "plan" | "price" }) {
  const actionFn = kind === "plan" ? togglePlanActiveAction : togglePlanPriceActiveAction;
  const [, action] = useActionState(actionFn, initialState);
  const [pending, startTransition] = useTransition();

  function submit() {
    const formData = new FormData();
    formData.set("id", id);
    formData.set("active", (!active).toString());
    startTransition(() => action(formData));
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={submit} disabled={pending}>
      {active ? "Deactivate" : "Activate"}
    </Button>
  );
}
