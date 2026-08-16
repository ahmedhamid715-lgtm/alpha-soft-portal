"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createInvitation, revokeInvitation, resendInvitation } from "@/server/services/invitation-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface InvitationActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
}

const createSchema = z.object({ organizationId: z.string().uuid(), email: z.string().email(), roleId: z.string().uuid() });

/**
 * Every real check (`members.invite`, role scope/ownership, duplicate
 * prevention, rate limiting) lives in `createInvitation()`
 * (`invitation-service.ts`) — this action only shapes the form.
 */
export async function createInvitationAction(
  _prevState: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const parsed = safeParseResult(createSchema, {
    organizationId: formData.get("organizationId"),
    email: formData.get("email"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await createInvitation(parsed.data);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/invitations`);
  return { success: true };
}

const invitationActionSchema = z.object({ organizationId: z.string().uuid(), invitationId: z.string().uuid() });

export async function revokeInvitationAction(_prevState: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  const parsed = safeParseResult(invitationActionSchema, {
    organizationId: formData.get("organizationId"),
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await revokeInvitation(parsed.data);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/invitations`);
  return { success: true };
}

export async function resendInvitationAction(_prevState: InvitationActionState, formData: FormData): Promise<InvitationActionState> {
  const parsed = safeParseResult(invitationActionSchema, {
    organizationId: formData.get("organizationId"),
    invitationId: formData.get("invitationId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await resendInvitation(parsed.data);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/invitations`);
  return { success: true };
}
