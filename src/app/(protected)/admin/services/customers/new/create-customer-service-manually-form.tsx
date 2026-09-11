"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createCustomerServiceFormAction, type ServiceFormState } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { ServiceDefinition, User } from "@/generated/prisma/client";

export interface EligibleCompany {
  id: string;
  name: string;
  convertedToOrganizationId: string;
}

const initialState: ServiceFormState = {};

/** Manual creation for an EXISTING, already-converted customer — same shape as `admin/projects/new`'s own `CreateProjectForm`. */
export function CreateCustomerServiceManuallyForm({ companies, definitions, assignableUsers }: { companies: EligibleCompany[]; definitions: ServiceDefinition[]; assignableUsers: User[] }) {
  const [state, formAction, pending] = useActionState(createCustomerServiceFormAction, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const companyIdInputId = useId();
  const definitionId = useId();
  const quantityId = useId();
  const ownerId = useId();
  const startDateId = useId();
  const targetEndDateId = useId();

  const customerOrganizationId = useMemo(() => companies.find((c) => c.id === companyId)?.convertedToOrganizationId ?? "", [companies, companyId]);

  if (companies.length === 0) {
    return <p className="text-sm text-muted-foreground">No customers are eligible yet — a company must first convert to a customer organization (Client Onboarding) before a service can be created for them.</p>;
  }
  if (definitions.length === 0) {
    return <p className="text-sm text-muted-foreground">No active service definitions exist yet — create one in the catalog first.</p>;
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
            <Label htmlFor={definitionId}>Service definition</Label>
            <select id={definitionId} name="serviceDefinitionId" defaultValue={definitions[0]!.id} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm" required>
              {definitions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={quantityId}>Quantity</Label>
            <Input id={quantityId} name="quantity" type="number" min={1} defaultValue={1} />
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
            Create customer service
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
