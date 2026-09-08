"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createProposalTemplateAction, updateProposalTemplateAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RichTextFoundation } from "@/components/shared/rich-text-foundation";
import type { CrmProposalTemplate } from "@/generated/prisma/client";

/** Create or edit a proposal template — the same fields either way, matching `NewCompanyForm`/`DealEditForm`'s own "one form component, an optional `template` prop switches create/edit" shape. */
export function TemplateForm({ template }: { template?: CrmProposalTemplate }) {
  const [name, setName] = useState(template?.name ?? "");
  const [defaultTitle, setDefaultTitle] = useState(template?.defaultTitle ?? "");
  const [defaultBodyHtml, setDefaultBodyHtml] = useState(template?.defaultBodyHtml ?? "");
  const [defaultTermsHtml, setDefaultTermsHtml] = useState(template?.defaultTermsHtml ?? "");
  const [defaultValidityDays, setDefaultValidityDays] = useState(String(template?.defaultValidityDays ?? 30));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!name.trim() || !defaultTitle.trim() || !defaultBodyHtml.trim()) return;
    setError(null);
    startTransition(async () => {
      const payload = { name, defaultTitle, defaultBodyHtml, defaultTermsHtml: defaultTermsHtml || undefined, defaultValidityDays: Number(defaultValidityDays) || 30 };
      const result = template ? await updateProposalTemplateAction({ templateId: template.id, ...payload }) : await createProposalTemplateAction(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!template) {
        setName("");
        setDefaultTitle("");
        setDefaultBodyHtml("");
        setDefaultTermsHtml("");
        setDefaultValidityDays("30");
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="template-name">Template name</Label>
          <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard SEO Services" disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="template-validity">Default validity (days)</Label>
          <Input id="template-validity" type="number" min={1} max={3650} value={defaultValidityDays} onChange={(e) => setDefaultValidityDays(e.target.value)} disabled={pending} />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <Label htmlFor="template-title">Default proposal title</Label>
          <Input id="template-title" value={defaultTitle} onChange={(e) => setDefaultTitle(e.target.value)} disabled={pending} maxLength={200} />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-body">Default body</Label>
        <RichTextFoundation aria-label="Default proposal body" value={defaultBodyHtml} onChange={setDefaultBodyHtml} className="min-h-28" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="template-terms">Default terms (optional)</Label>
        <RichTextFoundation aria-label="Default proposal terms" value={defaultTermsHtml} onChange={setDefaultTermsHtml} className="min-h-20" />
      </div>
      <Button onClick={handleSubmit} disabled={pending || !name.trim() || !defaultTitle.trim() || !defaultBodyHtml.trim()} className="w-fit">
        {template ? "Save changes" : "Create template"}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
