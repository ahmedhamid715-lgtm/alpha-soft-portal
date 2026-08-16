"use server";

import { z } from "zod";
import { acceptInvitation, type AcceptInvitationOutcome } from "@/server/services/invitation-service";
import { passwordSchema } from "@/lib/auth/password-policy";
import { authRateLimiter } from "@/lib/platform/rate-limit";
import { safeParseResult } from "@/lib/validation/parse";

const acceptSchema = z.object({
  token: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  password: passwordSchema.optional(),
});

export interface AcceptInvitationActionState {
  outcome?: AcceptInvitationOutcome["outcome"];
  organizationSlug?: string;
  fieldErrors?: Record<string, string[]>;
  error?: string;
}

/**
 * Accepts an invitation. Every real check (token validity/expiry/reuse,
 * email-match for an authenticated caller, atomic membership creation)
 * lives in `acceptInvitation()` — this action only shapes the form and
 * rate-limits by token prefix (spec section 42), the same pattern
 * `reset-password`'s action already established for an identical
 * "unauthenticated token in a URL" shape.
 */
export async function acceptInvitationAction(
  _prevState: AcceptInvitationActionState,
  formData: FormData,
): Promise<AcceptInvitationActionState> {
  const parsed = safeParseResult(acceptSchema, {
    token: formData.get("token"),
    name: formData.get("name") || undefined,
    password: formData.get("password") || undefined,
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  const rateLimit = await authRateLimiter.check(`invite-accept:${parsed.data.token.slice(0, 16)}`);
  if (!rateLimit.allowed) {
    return { error: "Too many attempts. Try again shortly." };
  }

  const result = await acceptInvitation(parsed.data);
  return {
    outcome: result.outcome,
    organizationSlug: "organizationSlug" in result ? result.organizationSlug : undefined,
  };
}
