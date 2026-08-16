"use server";

import { z } from "zod";
import { requestPasswordReset } from "@/server/services/password-reset-service";
import { authRateLimiter } from "@/lib/platform/rate-limit";
import { safeParseResult } from "@/lib/validation/parse";

const forgotPasswordSchema = z.object({ email: z.string().email("Enter a valid email address.") });

export interface ForgotPasswordActionState {
  /** Always the same message on success — never "no account with that email" (spec section 12/15, enumeration protection). */
  submitted?: boolean;
  fieldErrors?: Record<string, string[]>;
  error?: string;
}

export async function forgotPasswordAction(
  _prevState: ForgotPasswordActionState,
  formData: FormData,
): Promise<ForgotPasswordActionState> {
  const parsed = safeParseResult(forgotPasswordSchema, { email: formData.get("email") });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  const rateLimitKey = `forgot-password:${parsed.data.email.trim().toLowerCase()}`;
  const rateLimit = await authRateLimiter.check(rateLimitKey);
  if (!rateLimit.allowed) {
    // Still enumeration-safe — a generic throttling message, not
    // "you've already requested this," which would itself confirm the
    // account exists.
    return { error: "Too many requests. Try again in a few minutes." };
  }

  // requestPasswordReset() itself never reveals whether the account
  // exists — see its doc comment. The action's job is just to always
  // return the same "submitted" state regardless of what happened
  // internally.
  await requestPasswordReset({ email: parsed.data.email });
  return { submitted: true };
}
