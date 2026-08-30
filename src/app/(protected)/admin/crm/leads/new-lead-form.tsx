"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createLeadAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmCompany, CrmLeadSource, User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";

export function NewLeadForm({ companies, sources, users }: { companies: CrmCompany[]; sources: CrmLeadSource[]; users: User[] }) {
  const [title, setTitle] = useState("");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [sourceId, setSourceId] = useState(UNASSIGNED);
  const [assignedToUserId, setAssignedToUserId] = useState(UNASSIGNED);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!title.trim() || !companyId) return;
    setError(null);
    startTransition(async () => {
      const result = await createLeadAction({
        title,
        companyId,
        description: description || undefined,
        sourceId: sourceId === UNASSIGNED ? undefined : sourceId,
        assignedToUserId: assignedToUserId === UNASSIGNED ? undefined : assignedToUserId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.data) {
        setTitle("");
        setDescription("");
        router.refresh();
      }
    });
  }

  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">Create a company first before adding a lead.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-title">Title</Label>
          <Input id="lead-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SEO audit for Acme" disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-company">Company</Label>
          <Select value={companyId} onValueChange={setCompanyId} disabled={pending}>
            <SelectTrigger id="lead-company" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-source">Source (optional)</Label>
          <Select value={sourceId} onValueChange={setSourceId} disabled={pending}>
            <SelectTrigger id="lead-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>None</SelectItem>
              {sources.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="lead-assignee">Assign to (optional)</Label>
          <Select value={assignedToUserId} onValueChange={setAssignedToUserId} disabled={pending}>
            <SelectTrigger id="lead-assignee" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lead-description">Description (optional)</Label>
        <Textarea id="lead-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} disabled={pending} maxLength={4000} />
      </div>
      <Button onClick={handleSubmit} disabled={pending || !title.trim() || !companyId} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Create lead
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
