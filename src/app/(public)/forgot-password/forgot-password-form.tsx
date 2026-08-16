"use client";

import { useActionState, useId } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { forgotPasswordAction, type ForgotPasswordActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const initialState: ForgotPasswordActionState = {};

export function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(forgotPasswordAction, initialState);
  const emailId = useId();

  if (state.submitted) {
    return (
      <Alert>
        <CheckCircle2 />
        <AlertTitle>Check your email</AlertTitle>
        <AlertDescription>
          If an account exists for that email address, we&apos;ve sent instructions to reset your password.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={emailId}>Email</Label>
        <Input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={!!state.fieldErrors?.email}
          aria-describedby={state.fieldErrors?.email ? `${emailId}-error` : undefined}
        />
        {state.fieldErrors?.email ? (
          <p id={`${emailId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.email[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Send reset instructions
      </Button>
    </form>
  );
}
