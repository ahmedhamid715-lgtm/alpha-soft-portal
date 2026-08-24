"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createSourceAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CLASSIFICATIONS = [
  { value: "PUBLIC", label: "Public" },
  { value: "INTERNAL", label: "Internal" },
  { value: "CONFIDENTIAL", label: "Confidential (requires knowledge.source.manage to retrieve)" },
  { value: "RESTRICTED", label: "Restricted (requires knowledge.source.manage to retrieve)" },
] as const;

export function NewSourceForm({ organizationId }: { organizationId: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [classification, setClassification] = useState<string>("INTERNAL");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createSourceAction({ organizationId, name, description: description || undefined, classification });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.source) {
        setName("");
        setDescription("");
        router.push(`/organizations/${organizationId}/knowledge/${result.source.id}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-name">Name</Label>
        <Input id="source-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support FAQ" disabled={pending} maxLength={200} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-description">Description (optional)</Label>
        <Textarea id="source-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={pending} maxLength={2000} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="source-classification">Classification</Label>
        <Select value={classification} onValueChange={setClassification} disabled={pending}>
          <SelectTrigger id="source-classification" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLASSIFICATIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={handleSubmit} disabled={pending || !name.trim()} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Create source
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
