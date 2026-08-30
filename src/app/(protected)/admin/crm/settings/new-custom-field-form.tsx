"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createCustomFieldDefinitionAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmCustomFieldEntityType, CrmCustomFieldType } from "@/generated/prisma/client";

const FIELD_TYPES: { value: CrmCustomFieldType; label: string }[] = [
  { value: "TEXT", label: "Text" },
  { value: "NUMBER", label: "Number" },
  { value: "DATE", label: "Date" },
  { value: "BOOLEAN", label: "Yes/No" },
  { value: "SELECT", label: "Select (comma-separated options)" },
];

export function NewCustomFieldForm({ entityType }: { entityType: CrmCustomFieldEntityType }) {
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [fieldType, setFieldType] = useState<CrmCustomFieldType>("TEXT");
  const [options, setOptions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!label.trim() || !key.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createCustomFieldDefinitionAction({
        entityType,
        label,
        key,
        fieldType,
        options: fieldType === "SELECT" ? options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setLabel("");
      setKey("");
      setOptions("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${entityType}-field-label`}>Label</Label>
          <Input id={`${entityType}-field-label`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Deal size band" disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${entityType}-field-key`}>Key (lower_snake_case)</Label>
          <Input id={`${entityType}-field-key`} value={key} onChange={(e) => setKey(e.target.value)} placeholder="deal_size_band" disabled={pending} maxLength={100} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${entityType}-field-type`}>Type</Label>
          <Select value={fieldType} onValueChange={(v) => setFieldType(v as CrmCustomFieldType)} disabled={pending}>
            <SelectTrigger id={`${entityType}-field-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FIELD_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {fieldType === "SELECT" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${entityType}-field-options`}>Options</Label>
            <Input id={`${entityType}-field-options`} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Small, Medium, Large" disabled={pending} />
          </div>
        ) : null}
      </div>
      <Button onClick={handleSubmit} disabled={pending || !label.trim() || !key.trim()} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Add field
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
