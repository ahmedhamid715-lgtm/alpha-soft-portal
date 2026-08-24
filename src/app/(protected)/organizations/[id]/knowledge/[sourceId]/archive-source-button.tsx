"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive } from "lucide-react";
import { archiveSourceAction } from "../actions";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";

export function ArchiveSourceButton({ organizationId, sourceId }: { organizationId: string; sourceId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      await archiveSourceAction({ organizationId, sourceId });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Archive className="size-4" aria-hidden="true" />
        Archive source
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Archive this knowledge source?"
        description="Its documents stop being retrievable, but nothing is deleted — you can review its history at any time."
        confirmLabel="Archive"
        variant="destructive"
        loading={pending}
        onConfirm={handleConfirm}
      />
    </>
  );
}
