"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createContactAction } from "../../actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function NewContactForm({ companyId }: { companyId: string }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!firstName.trim() || !lastName.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createContactAction({ companyId, firstName, lastName, email: email || undefined, jobTitle: jobTitle || undefined });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) {
        setFirstName("");
        setLastName("");
        setEmail("");
        setJobTitle("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-first-name">First name</Label>
          <Input id="contact-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} disabled={pending} maxLength={100} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-last-name">Last name</Label>
          <Input id="contact-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} disabled={pending} maxLength={100} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-email">Email (optional)</Label>
          <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={pending} maxLength={255} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-job-title">Job title (optional)</Label>
          <Input id="contact-job-title" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} disabled={pending} maxLength={200} />
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={pending || !firstName.trim() || !lastName.trim()} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Add contact
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
