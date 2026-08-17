"use client";

import { useActionState, useId } from "react";
import { AlertCircle } from "lucide-react";
import { createPlatformUserAction, type UserActionState } from "@/app/(protected)/admin/users/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const initialState: UserActionState = {};

export function CreatePlatformUserForm({ roleOptions }: { roleOptions: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(createPlatformUserAction, initialState);
  const emailId = useId();
  const nameId = useId();
  const roleId = useId();

  return (
    <Card className="max-w-lg">
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          {state.error ? (
            <Alert variant="destructive" role="alert">
              <AlertCircle />
              <AlertDescription>{state.error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={emailId}>Email</Label>
            <Input id={emailId} name="email" type="email" required autoComplete="off" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Name</Label>
            <Input id={nameId} name="name" type="text" required maxLength={200} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleId}>Platform role</Label>
            <Select name="roleId" required>
              <SelectTrigger id={roleId} className="w-full">
                <SelectValue placeholder="Choose a role…" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-sm text-muted-foreground">
            They&apos;ll receive an email with a link to set their own password. This link expires in 1 hour.
          </p>

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? "Creating…" : "Create user"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
