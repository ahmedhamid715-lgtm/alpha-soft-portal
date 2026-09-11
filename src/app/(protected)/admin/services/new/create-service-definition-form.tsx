"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createServiceDefinitionFormAction, type ServiceFormState } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { SERVICE_CATEGORY_LABELS, SERVICE_DELIVERY_CADENCE_LABELS } from "@/components/services/service-status";
import type { ServiceCategory } from "@/generated/prisma/client";

const initialState: ServiceFormState = {};

const CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS) as ServiceCategory[];
const CADENCES = Object.keys(SERVICE_DELIVERY_CADENCE_LABELS) as ("ONE_TIME" | "RECURRING" | "ONGOING")[];

export function CreateServiceDefinitionForm() {
  const [state, formAction, pending] = useActionState(createServiceDefinitionFormAction, initialState);
  const nameId = useId();
  const codeId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const cadenceId = useId();

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
            <Label htmlFor={nameId}>Name</Label>
            <Input id={nameId} name="name" maxLength={200} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={codeId}>Code</Label>
            <Input id={codeId} name="code" maxLength={50} placeholder="SEO-CORE" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={descriptionId}>Description</Label>
            <Textarea id={descriptionId} name="description" maxLength={2000} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={categoryId}>Category</Label>
              <select id={categoryId} name="category" defaultValue="SEO" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {SERVICE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={cadenceId}>Delivery cadence</Label>
              <select id={cadenceId} name="deliveryCadence" defaultValue="RECURRING" className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                {CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {SERVICE_DELIVERY_CADENCE_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create service definition
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
