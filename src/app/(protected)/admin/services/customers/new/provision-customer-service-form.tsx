"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createCustomerServiceFormAction, type ServiceFormState } from "../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import type { ServiceDefinition, User } from "@/generated/prisma/client";

const initialState: ServiceFormState = {};

export function ProvisionCustomerServiceForm({
  sourceOnboardingServiceItemId,
  itemTitle,
  companyName,
  definitions,
  assignableUsers,
}: {
  sourceOnboardingServiceItemId: string;
  itemTitle: string;
  companyName: string;
  definitions: ServiceDefinition[];
  assignableUsers: User[];
}) {
  const [state, formAction, pending] = useActionState(createCustomerServiceFormAction, initialState);
  const definitionId = useId();
  const quantityId = useId();
  const ownerId = useId();
  const startDateId = useId();
  const targetEndDateId = useId();

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
          <input type="hidden" name="sourceOnboardingServiceItemId" value={sourceOnboardingServiceItemId} />
          <p className="text-sm text-muted-foreground">
            Provisioning &ldquo;{itemTitle}&rdquo; for {companyName}.
          </p>
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
            Provision service
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
