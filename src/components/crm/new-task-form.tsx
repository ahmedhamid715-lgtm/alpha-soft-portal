"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createTaskAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { User } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";

type ParentRef = { leadId: string } | { companyId: string } | { contactId: string };

export function NewTaskForm({ parentRef, users }: { parentRef: ParentRef; users: User[] }) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assignedToUserId, setAssignedToUserId] = useState(UNASSIGNED);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createTaskAction({
        ...parentRef,
        title,
        dueAt: dueAt || undefined,
        assignedToUserId: assignedToUserId === UNASSIGNED ? undefined : assignedToUserId,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setDueAt("");
      setAssignedToUserId(UNASSIGNED);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-title">Follow-up task</Label>
          <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Call back next week" disabled={pending} maxLength={200} className="w-64" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-due">Due date</Label>
          <Input id="task-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} disabled={pending} className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-assignee">Assign to</Label>
          <Select value={assignedToUserId} onValueChange={setAssignedToUserId} disabled={pending}>
            <SelectTrigger id="task-assignee" className="w-44">
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
        <Button onClick={handleSubmit} disabled={pending || !title.trim()}>
          <Plus className="size-4" aria-hidden="true" />
          Add task
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
