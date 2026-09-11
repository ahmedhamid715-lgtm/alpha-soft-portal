"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { updateServiceDefinitionAction, archiveServiceDefinitionAction, reactivateServiceDefinitionAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { serviceDefinitionStatusVariant, SERVICE_CATEGORY_LABELS, SERVICE_DELIVERY_CADENCE_LABELS } from "@/components/services/service-status";
import type { ServiceDefinition, ServiceCategory } from "@/generated/prisma/client";

const CATEGORIES = Object.keys(SERVICE_CATEGORY_LABELS) as ServiceCategory[];
const CADENCES = Object.keys(SERVICE_DELIVERY_CADENCE_LABELS) as ("ONE_TIME" | "RECURRING" | "ONGOING")[];

export function ServiceDefinitionDetail({ definition, canManage }: { definition: ServiceDefinition; canManage: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const nameId = useId();
  const descriptionId = useId();
  const categoryId = useId();
  const cadenceId = useId();

  function runAction(action: () => Promise<{ error?: string }>) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) router.refresh();
    });
  }

  function handleSave(formData: FormData) {
    const name = formData.get("name");
    const description = formData.get("description");
    const category = formData.get("category");
    const deliveryCadence = formData.get("deliveryCadence");
    runAction(() =>
      updateServiceDefinitionAction({
        definitionId: definition.id,
        name: typeof name === "string" && name.length > 0 ? name : undefined,
        description: typeof description === "string" ? (description.length > 0 ? description : null) : undefined,
        category: typeof category === "string" && category.length > 0 ? category : undefined,
        deliveryCadence: typeof deliveryCadence === "string" && deliveryCadence.length > 0 ? deliveryCadence : undefined,
      }),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <StatusBadge status={serviceDefinitionStatusVariant(definition.status)}>{definition.status}</StatusBadge>
        <span className="text-xs text-muted-foreground">Code: {definition.code}</span>
      </div>

      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent>
          <form action={canManage ? handleSave : undefined} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input id={nameId} name="name" defaultValue={definition.name} maxLength={200} disabled={!canManage || pending} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea id={descriptionId} name="description" defaultValue={definition.description ?? ""} maxLength={2000} rows={3} disabled={!canManage || pending} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={categoryId}>Category</Label>
                <select id={categoryId} name="category" defaultValue={definition.category} disabled={!canManage || pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {SERVICE_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={cadenceId}>Delivery cadence</Label>
                <select id={cadenceId} name="deliveryCadence" defaultValue={definition.deliveryCadence} disabled={!canManage || pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  {CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {SERVICE_DELIVERY_CADENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {canManage ? (
              <Button type="submit" disabled={pending} className="w-fit">
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Save changes
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {canManage ? (
        <div className="flex gap-2">
          {definition.status === "ACTIVE" ? (
            <Button variant="ghost" disabled={pending} onClick={() => runAction(() => archiveServiceDefinitionAction({ definitionId: definition.id }))}>
              Archive
            </Button>
          ) : (
            <Button variant="outline" disabled={pending} onClick={() => runAction(() => reactivateServiceDefinitionAction({ definitionId: definition.id }))}>
              Reactivate
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
