"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createInternalTaskFormAction, type InternalTaskFormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { User } from "@/generated/prisma/client";

const initialState: InternalTaskFormState = {};

export function CreateInternalTaskForm({ assignableUsers }: { assignableUsers: User[] }) {
  const [state, formAction, pending] = useActionState(createInternalTaskFormAction, initialState);
  const titleId = useId();
  const descriptionId = useId();
  const priorityId = useId();
  const assigneeId = useId();
  const dueAtId = useId();

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4" noValidate>
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} name="title" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={2000} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={priorityId}>Priority</Label>
              <select id={priorityId} name="priority" defaultValue="MEDIUM" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={dueAtId}>Due date</Label>
              <Input id={dueAtId} name="dueAt" type="date" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={assigneeId}>Assignee</Label>
            <select id={assigneeId} name="assignedToUserId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="">Unassigned</option>
              {assignableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create task
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
