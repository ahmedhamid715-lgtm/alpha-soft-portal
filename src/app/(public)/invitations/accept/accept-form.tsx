"use client";

import { useActionState, useId, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { acceptInvitationAction, type AcceptInvitationActionState } from "./actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

const initialState: AcceptInvitationActionState = {};

const OUTCOME_MESSAGES: Record<string, { title: string; description: string }> = {
  invalid: { title: "This invitation link is invalid.", description: "Double-check the link, or ask for a new invitation." },
  expired: { title: "This invitation has expired.", description: "Ask an organization admin to resend it." },
  already_used: { title: "This invitation has already been used.", description: "Ask an organization admin to resend it if you still need access." },
  email_mismatch: { title: "This invitation isn't for your signed-in account.", description: "Sign out and try again, or ask for a new invitation addressed to your email." },
};

export function AcceptInvitationForm({
  token,
  organizationName,
  roleName,
  email,
  isAuthenticated,
  authenticatedEmail,
}: {
  token: string;
  organizationName: string;
  roleName: string;
  email: string;
  isAuthenticated: boolean;
  authenticatedEmail?: string;
}) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const nameId = useId();
  const passwordId = useId();

  if (state.outcome === "accepted") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <CheckCircle2 />
          <AlertTitle>You&apos;ve joined {organizationName}</AlertTitle>
          <AlertDescription>Signed in as {roleName}.</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href="/organizations">Go to your organizations</Link>
        </Button>
      </div>
    );
  }

  if (state.outcome === "account_required") {
    return (
      <div className="flex flex-col gap-4">
        <Alert>
          <AlertCircle />
          <AlertTitle>An account already exists for {email}</AlertTitle>
          <AlertDescription>Sign in, then come back to this link to accept.</AlertDescription>
        </Alert>
        <Button asChild>
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/invitations/accept?token=${token}`)}`}>Sign in</Link>
        </Button>
      </div>
    );
  }

  if (state.outcome && OUTCOME_MESSAGES[state.outcome]) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle />
        <AlertTitle>{OUTCOME_MESSAGES[state.outcome].title}</AlertTitle>
        <AlertDescription>{OUTCOME_MESSAGES[state.outcome].description}</AlertDescription>
      </Alert>
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

      <p className="text-sm text-muted-foreground">
        You&apos;ve been invited to join <strong className="text-foreground">{organizationName}</strong> as <strong className="text-foreground">{roleName}</strong> ({email}).
      </p>

      {isAuthenticated ? (
        authenticatedEmail && authenticatedEmail.toLowerCase() !== email.toLowerCase() ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertDescription>You&apos;re signed in as {authenticatedEmail}, but this invitation is for {email}. Sign out first.</AlertDescription>
          </Alert>
        ) : (
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Accept invitation
          </Button>
        )
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={nameId}>Your name</Label>
            <Input id={nameId} name="name" required maxLength={200} aria-describedby={state.fieldErrors?.name ? `${nameId}-error` : undefined} />
            {state.fieldErrors?.name ? (
              <p id={`${nameId}-error`} role="alert" className="text-sm font-medium text-destructive">
                {state.fieldErrors.name[0]}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={passwordId}>Choose a password</Label>
            <InputGroup>
              <InputGroupInput
                id={passwordId}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                aria-describedby={state.fieldErrors?.password ? `${passwordId}-error` : `${passwordId}-hint`}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton type="button" size="icon-xs" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            {state.fieldErrors?.password ? (
              <p id={`${passwordId}-error`} role="alert" className="text-sm font-medium text-destructive">
                {state.fieldErrors.password[0]}
              </p>
            ) : (
              <p id={`${passwordId}-hint`} className="text-sm text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters.</p>
            )}
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
            Create account & join
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href={`/login?callbackUrl=${encodeURIComponent(`/invitations/accept?token=${token}`)}`} className="font-medium text-link hover:underline">
              Sign in
            </Link>
          </p>
        </>
      )}
    </form>
  );
}
