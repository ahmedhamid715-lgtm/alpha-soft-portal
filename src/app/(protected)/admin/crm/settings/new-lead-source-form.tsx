"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createLeadSourceAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewLeadSourceForm() {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createLeadSourceAction({ name });
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
        <Label htmlFor="lead-source-name">New lead source</Label>
        <Input id="lead-source-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Referral" disabled={pending} maxLength={100} className="w-64" />
      </div>
      <Button onClick={handleSubmit} disabled={pending || !name.trim()}>
        <Plus className="size-4" aria-hidden="true" />
        Add
      </Button>
      {error ? (
        <Alert variant="destructive" className="w-full">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
