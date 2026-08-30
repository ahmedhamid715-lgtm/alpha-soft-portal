"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateCustomFieldDefinitionAction } from "../actions";

export function CustomFieldToggle({ definitionId, isActive }: { definitionId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      await updateCustomFieldDefinitionAction({ definitionId, isActive: !isActive });
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleClick}>
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
