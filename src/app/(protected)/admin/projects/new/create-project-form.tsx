"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createProjectAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";

export interface EligibleCompany {
  id: string;
  name: string;
  convertedToOrganizationId: string;
}

const initialState: ProjectActionState = {};

/** Manual creation for an EXISTING, already-converted customer — see `project-service.ts`'s own `createProject()` doc comment. */
export function CreateProjectForm({ companies }: { companies: EligibleCompany[] }) {
  const [state, formAction, pending] = useActionState(createProjectAction, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const companyIdInputId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const priorityId = useId();
  const startDateId = useId();
  const targetEndDateId = useId();

  const customerOrganizationId = useMemo(() => companies.find((c) => c.id === companyId)?.convertedToOrganizationId ?? "", [companies, companyId]);

  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">No customers are eligible yet — a company must first convert to a customer organization (Client Onboarding) before a project can be created for them.</p>;
  }

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
          <input type="hidden" name="customerOrganizationId" value={customerOrganizationId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={companyIdInputId}>Customer</Label>
            <select id={companyIdInputId} name="companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" required>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={titleId}>Title</Label>
            <Input id={titleId} name="title" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={5000} rows={2} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={priorityId}>Priority</Label>
            <select id={priorityId} name="priority" defaultValue="MEDIUM" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={startDateId}>Start date</Label>
              <Input id={startDateId} name="startDate" type="date" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={targetEndDateId}>Target end date</Label>
              <Input id={targetEndDateId} name="targetEndDate" type="date" />
            </div>
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create project
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
