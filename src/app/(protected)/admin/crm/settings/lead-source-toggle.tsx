"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateLeadSourceAction } from "../actions";

export function LeadSourceToggle({ leadSourceId, isActive }: { leadSourceId: string; isActive: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      await updateLeadSourceAction({ leadSourceId, isActive: !isActive });
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={handleClick}>
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
