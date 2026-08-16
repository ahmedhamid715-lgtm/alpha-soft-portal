"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/auth";
import { authRateLimiter } from "@/lib/platform/rate-limit";
import { resolveDestination } from "@/lib/auth/destination";
import { safeParseResult } from "@/lib/validation/parse";
import { userRepository } from "@/server/repositories/user-repository";
import { membershipRepository } from "@/server/repositories/membership-repository";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export interface LoginActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * The one server action the login form submits to. Rate-limited *before*
 * touching Auth.js at all (spec section 14 — "the authentication surface
 * must be protected more aggressively than normal API routes"), keyed by
 * email (not IP alone — see rate-limit.ts's `authRateLimiter` comment).
 *
 * `signIn(..., { redirect: false })` is called specifically so this
 * function controls the post-login redirect itself — Auth.js's own
 * redirect target has no way to know the role-aware destination
 * (`resolveDestination`), which depends on who just authenticated, not
 * something decidable before `signIn` resolves.
 */
export async function loginAction(_prevState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const parsed = safeParseResult(loginSchema, {
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.fieldErrors };
  }

  const { email, password } = parsed.data;
  const rateLimitKey = `login:${email.trim().toLowerCase()}`;
  const rateLimit = await authRateLimiter.check(rateLimitKey);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts. Try again in a few minutes." };
  }

  try {
    await signIn("credentials", { email, password, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) {
      // Deliberately the same generic message regardless of *why*
      // authorize() returned null (no such account, wrong password,
      // suspended account, ...) — see auth-service.ts's verifyCredentials
      // doc comment and authentication.md "Enumeration protection."
      return { error: "Invalid email or password." };
    }
    throw error;
  }

  // Resolve the destination from the email we just authenticated,
  // *not* by reading the session back via `auth()`/`getCurrentUser()`.
  // `signIn()` sets the session cookie on the outgoing response, but a
  // `cookies()`/`auth()` read within this *same* Server Action execution
  // still sees the incoming request's (cookie-less) state — the browser
  // hasn't round-tripped the new cookie back yet. Looking the
  // just-authenticated user up directly (we already know their email —
  // `signIn` wouldn't have succeeded otherwise) sidesteps that entirely,
  // and was found by testing the actual login flow, not by inspection:
  // every login was silently landing on the generic customer destination
  // regardless of role until this fix.
  const user = await userRepository.findByEmail(email);
  const memberships = user ? await membershipRepository.listForUser(user.id) : [];
  const membershipRole = memberships.length === 1 ? memberships[0].role : null;

  // Prefer sending the user back where they were headed (e.g. proxy.ts
  // redirected them to /login from a protected page) — but only for a
  // same-origin relative path. A callbackUrl is untrusted client input;
  // accepting an absolute/external URL here would be an open-redirect
  // vulnerability, not a convenience.
  const callbackUrl = formData.get("callbackUrl");
  const destination =
    typeof callbackUrl === "string" && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : resolveDestination(membershipRole);

  redirect(destination);
}
