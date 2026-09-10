"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { instantiateFromTemplateAction, type ProjectActionState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { EligibleCompany } from "../../new/create-project-form";
import type { User } from "@/generated/prisma/client";

const initialState: ProjectActionState = {};

export function InstantiateForm({ templateId, companies, assignableUsers }: { templateId: string; companies: EligibleCompany[]; assignableUsers: User[] }) {
  const [state, formAction, pending] = useActionState(instantiateFromTemplateAction, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const companyIdInputId = useId();
  const titleId = useId();
  const startDateId = useId();
  const ownerId = useId();

  const customerOrganizationId = useMemo(() => companies.find((c) => c.id === companyId)?.convertedToOrganizationId ?? "", [companies, companyId]);

  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">No eligible customers yet — a company must first convert to a customer organization.</p>;
  }

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-3">
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}
          <input type="hidden" name="templateId" value={templateId} />
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
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId}>Title override (optional)</Label>
              <Input id={titleId} name="title" maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={startDateId}>Start date</Label>
              <Input id={startDateId} name="startDate" type="date" />
              <p className="text-xs text-muted-foreground">Needed to convert relative due-day offsets into real dates.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={ownerId}>Owner</Label>
              <select id={ownerId} name="ownerUserId" defaultValue="" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="">Unassigned</option>
                {assignableUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" className="w-fit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create project from template
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
