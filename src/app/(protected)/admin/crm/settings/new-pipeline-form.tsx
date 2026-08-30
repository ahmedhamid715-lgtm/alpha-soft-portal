"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createPipelineAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewPipelineForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createPipelineAction({ name });
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pipeline-name">New pipeline</Label>
        <Input id="pipeline-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Enterprise Pipeline" disabled={pending} maxLength={200} className="w-64" />
      </div>
      <Button onClick={handleSubmit} disabled={pending || !name.trim()}>
        <Plus className="size-4" aria-hidden="true" />
        Add pipeline
      </Button>
      {error ? (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
