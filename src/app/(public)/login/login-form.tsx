"use client";

import { useActionState, useId, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { AlertCircle } from "lucide-react";
import { loginAction, type LoginActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Alert, AlertDescription } from "@/components/ui/alert";

const initialState: LoginActionState = {};

/**
 * Plain `<form action={...}>` + `useActionState` (React 19's canonical
 * server-action form pattern), not the react-hook-form-based `Form`
 * primitive (Module 02) — that primitive earns its weight on forms with
 * many interdependent fields and rich client-side validation UX; a
 * two-field login form is simpler using the native pattern directly, and
 * degrades better (the form still submits, still gets server-validated,
 * before JS finishes hydrating).
 */
export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      {callbackUrl ? <input type="hidden" name="callbackUrl" value={callbackUrl} /> : null}

      {state.error ? (
        <Alert variant="destructive" id={errorId} role="alert">
          <AlertCircle />
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

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={passwordId}>Password</Label>
          <a href="/forgot-password" className="text-sm text-link underline-offset-4 hover:underline">
            Forgot password?
          </a>
        </div>
        <InputGroup>
          <InputGroupInput
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            aria-invalid={!!state.fieldErrors?.password}
            aria-describedby={state.fieldErrors?.password ? `${passwordId}-error` : undefined}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="button"
              size="icon-xs"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {state.fieldErrors?.password ? (
          <p id={`${passwordId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.password[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending} className="mt-1">
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Sign in
      </Button>
    </form>
  );
}
