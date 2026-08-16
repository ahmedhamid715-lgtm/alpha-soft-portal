"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { resetPasswordAction, type ResetPasswordActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const initialState: ResetPasswordActionState = {};

const RESULT_MESSAGES: Record<Exclude<ResetPasswordActionState["result"], undefined | "reset">, string> = {
  invalid: "This reset link is invalid.",
  expired: "This reset link has expired. Request a new one.",
  already_used: "This reset link has already been used.",
};

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const passwordId = useId();
  const confirmId = useId();

  if (state.result === "reset") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Password updated</AlertTitle>
          <AlertDescription>
            Your password has been reset and every active session has been signed out for security.
          </AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (state.result) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{RESULT_MESSAGES[state.result]}</AlertDescription>
        </Alert>
        <Button asChild variant="outline">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />

      {state.error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={passwordId}>New password</Label>
        <InputGroup>
          <InputGroupInput
            id={passwordId}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={PASSWORD_MIN_LENGTH}
            aria-invalid={!!state.fieldErrors?.password}
            aria-describedby={state.fieldErrors?.password ? `${passwordId}-error` : `${passwordId}-hint`}
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
        ) : (
          <p id={`${passwordId}-hint`} className="text-sm text-muted-foreground">
            At least {PASSWORD_MIN_LENGTH} characters.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={confirmId}>Confirm new password</Label>
        <Input
          id={confirmId}
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          aria-invalid={!!state.fieldErrors?.confirmPassword}
          aria-describedby={state.fieldErrors?.confirmPassword ? `${confirmId}-error` : undefined}
        />
        {state.fieldErrors?.confirmPassword ? (
          <p id={`${confirmId}-error`} role="alert" className="text-sm font-medium text-destructive">
            {state.fieldErrors.confirmPassword[0]}
          </p>
        ) : null}
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Reset password
      </Button>
    </form>
  );
}
