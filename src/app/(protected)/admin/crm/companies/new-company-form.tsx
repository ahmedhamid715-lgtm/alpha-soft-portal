"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createCompanyAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewCompanyForm() {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createCompanyAction({ name, domain: domain || undefined, industry: industry || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) {
        setName("");
        setDomain("");
        setIndustry("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-name">Name</Label>
          <Input id="company-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc." disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-domain">Domain (optional)</Label>
          <Input id="company-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="acme.com" disabled={pending} maxLength={255} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-industry">Industry (optional)</Label>
          <Input id="company-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Retail" disabled={pending} maxLength={200} />
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={pending || !name.trim()} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Create company
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
