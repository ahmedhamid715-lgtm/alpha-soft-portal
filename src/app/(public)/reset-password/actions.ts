"use server";

import { z } from "zod";
import { resetPassword } from "@/server/services/password-reset-service";
import { passwordSchema } from "@/lib/auth/password-policy";
import { authRateLimiter } from "@/lib/platform/rate-limit";
import { safeParseResult } from "@/lib/validation/parse";

const resetPasswordFormSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });

export interface ResetPasswordActionState {
  result?: "reset" | "invalid" | "expired" | "already_used";
  fieldErrors?: Record<string, string[]>;
  error?: string;
}

export async function resetPasswordAction(
  _prevState: ResetPasswordActionState,
  formData: FormData,
): Promise<ResetPasswordActionState> {
  const parsed = safeParseResult(resetPasswordFormSchema, {
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  // Keyed by a token prefix, not email (this form doesn't know the
  // account's email) — still bounds brute-forcing a specific token via
  // this endpoint.
  const rateLimit = await authRateLimiter.check(`reset-password:${parsed.data.token.slice(0, 16)}`);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts. Request a new reset link." };
  }

  const result = await resetPassword({ token: parsed.data.token, password: parsed.data.password });
  return { result };
}
