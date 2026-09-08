"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIntakeFieldAction, archiveIntakeFieldAction, reactivateIntakeFieldAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/shared/status-badge";
import type { CrmClientOnboardingIntakeField } from "@/generated/prisma/client";

const FIELD_TYPES = [
  { value: "SHORT_TEXT", label: "Short text" },
  { value: "LONG_TEXT", label: "Long text" },
  { value: "EMAIL", label: "Email" },
  { value: "PHONE", label: "Phone" },
  { value: "URL", label: "URL" },
  { value: "SELECT", label: "Select" },
  { value: "CHECKBOX", label: "Checkbox" },
  { value: "DATE", label: "Date" },
] as const;

export function NewIntakeFieldForm() {
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<(typeof FIELD_TYPES)[number]["value"]>("SHORT_TEXT");
  const [required, setRequired] = useState(true);
  const [optionsText, setOptionsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!label.trim()) return;
    setError(null);
    const options = fieldType === "SELECT" ? optionsText.split(",").map((o) => o.trim()).filter(Boolean) : undefined;
    startTransition(async () => {
      const result = await createIntakeFieldAction({ label, fieldType, required, options });
      if (result.error) {
        setError(result.error);
        return;
      }
      setLabel("");
      setOptionsText("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="new-field-label">Label</Label>
          <Input id="new-field-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Primary billing contact" disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-field-type">Type</Label>
          <Select value={fieldType} onValueChange={(v) => setFieldType(v as typeof fieldType)} disabled={pending}>
            <SelectTrigger id="new-field-type" className="w-full">
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
      </div>
      {fieldType === "SELECT" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-field-options">Options (comma-separated)</Label>
          <Input id="new-field-options" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="e.g. WordPress, Shopify, Custom" disabled={pending} maxLength={2000} />
        </div>
      ) : null}
      <label className="flex items-center gap-1.5 text-sm">
        <Checkbox checked={required} onCheckedChange={(v) => setRequired(v === true)} disabled={pending} /> Required
      </label>
      <Button size="sm" className="w-fit" disabled={pending || !label.trim() || (fieldType === "SELECT" && !optionsText.trim())} onClick={handleSubmit}>
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

export function IntakeFieldRow({ field }: { field: CrmClientOnboardingIntakeField }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = field.status === "ACTIVE" ? await archiveIntakeFieldAction({ fieldId: field.id }) : await reactivateIntakeFieldAction({ fieldId: field.id });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{field.label}</span>
          <span className="text-xs text-muted-foreground">{field.fieldType}</span>
          {field.required ? <span className="text-xs text-muted-foreground">(required)</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={field.status === "ACTIVE" ? "success" : "neutral"}>{field.status}</StatusBadge>
          <Button size="sm" variant="outline" disabled={pending} onClick={toggle}>
            {field.status === "ACTIVE" ? "Archive" : "Reactivate"}
          </Button>
        </div>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
