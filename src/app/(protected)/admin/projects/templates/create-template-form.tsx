"use client";

import { useActionState, useId } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { createTemplateAction, type ProjectActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { SectionHeader } from "@/components/layout/section-header";

const initialState: ProjectActionState = {};

export function CreateTemplateForm() {
  const [state, formAction, pending] = useActionState(createTemplateAction, initialState);
  const nameId = useId();
  const descriptionId = useId();
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title="New template" />
      <Card className="max-w-md">
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
              <Label htmlFor={descriptionId}>Description</Label>
              <Textarea id={descriptionId} name="description" maxLength={5000} rows={2} />
            </div>
            <Button type="submit" disabled={pending} className="w-fit">
              {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Create template
            </Button>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
