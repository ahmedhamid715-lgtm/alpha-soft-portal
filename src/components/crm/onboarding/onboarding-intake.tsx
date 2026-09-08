"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordIntakeResponseAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { CrmClientOnboardingIntakeField, CrmClientOnboardingIntakeResponse } from "@/generated/prisma/client";

/** Staff-recorded intake only — no customer self-service surface exists yet (see the model's own schema comment). One field at a time, saved individually via `recordIntakeResponseAction()`'s own upsert semantics. */
export function OnboardingIntake({ onboardingId, fields, responses, canManage }: { onboardingId: string; fields: CrmClientOnboardingIntakeField[]; responses: CrmClientOnboardingIntakeResponse[]; canManage: boolean }) {
  const responseByFieldId = new Map(responses.map((r) => [r.fieldId, r.value]));
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(responses.map((r) => [r.fieldId, r.value ?? ""])));
  const [savingFieldId, setSavingFieldId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const router = useRouter();

  function save(fieldId: string, value: string) {
    setError(null);
    setSavingFieldId(fieldId);
    startTransition(async () => {
      const result = await recordIntakeResponseAction({ onboardingId, fieldId, value: value.trim() === "" ? null : value });
      setSavingFieldId(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (fields.length === 0) {
    return <p className="text-sm text-muted-foreground">No intake fields configured yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => {
        const value = drafts[field.id] ?? "";
        const answered = responseByFieldId.get(field.id);
        const setValue = (v: string) => setDrafts((prev) => ({ ...prev, [field.id]: v }));

        return (
          <div key={field.id} className="flex flex-col gap-1.5">
            <Label htmlFor={`intake-${field.id}`}>
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            {!canManage ? (
              <p className="text-sm">{answered ?? <span className="text-muted-foreground">Not answered</span>}</p>
            ) : field.fieldType === "LONG_TEXT" ? (
              <Textarea id={`intake-${field.id}`} value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => save(field.id, value)} rows={3} maxLength={4000} disabled={savingFieldId === field.id} />
            ) : field.fieldType === "CHECKBOX" ? (
              <Checkbox id={`intake-${field.id}`} checked={value === "true"} onCheckedChange={(v) => { const next = v === true ? "true" : "false"; setValue(next); save(field.id, next); }} disabled={savingFieldId === field.id} />
            ) : field.fieldType === "SELECT" ? (
              <Select value={value || undefined} onValueChange={(v) => { setValue(v); save(field.id, v); }} disabled={savingFieldId === field.id}>
                <SelectTrigger id={`intake-${field.id}`} className="w-full">
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {(Array.isArray(field.options) ? (field.options as unknown[]).filter((o): o is string => typeof o === "string") : []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={`intake-${field.id}`}
                type={field.fieldType === "EMAIL" ? "email" : field.fieldType === "URL" ? "url" : field.fieldType === "DATE" ? "date" : field.fieldType === "PHONE" ? "tel" : "text"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => save(field.id, value)}
                maxLength={4000}
                disabled={savingFieldId === field.id}
              />
            )}
          </div>
        );
      })}
      {canManage ? <p className="text-xs text-muted-foreground">Responses save automatically when you leave a field.</p> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
