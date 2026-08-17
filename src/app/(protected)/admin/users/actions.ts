"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createPlatformUser,
  updateUserProfile,
  suspendUser,
  reactivateUser,
  deactivateUser,
  revokeUserSession,
} from "@/server/services/user-management-service";
import { resendInvitation, revokeInvitation } from "@/server/services/invitation-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

/**
 * Every function here is a thin wrapper — all real authorization,
 * validation, last-owner/self-protection, and audit logic lives in
 * `user-management-service.ts` (spec section 4's own "no authorization
 * decisions inside React components/Server Actions" — this file never
 * makes one). Same shape as `organizations/[id]/members/actions.ts`.
 */

export interface UserActionState {
  error?: string;
  success?: boolean;
}

const createSchema = z.object({ email: z.string().email(), name: z.string().min(1).max(200), roleId: z.string().uuid() });

export async function createPlatformUserAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(createSchema, {
    email: formData.get("email"),
    name: formData.get("name"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { error: "Please check the form for errors." };

  let userId: string;
  try {
    const created = await createPlatformUser(parsed.data);
    userId = created.id;
  } catch (error) {
    return { error: toAppError(error).message };
  }

  revalidatePath("/admin/users");
  redirect(`/admin/users/${userId}`);
}

const userIdSchema = z.object({ userId: z.string().uuid() });

export async function updateUserProfileAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(z.object({ userId: z.string().uuid(), name: z.string().min(1).max(200) }), {
    userId: formData.get("userId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return { error: "Invalid input." };

  try {
    await updateUserProfile(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { success: true };
}

export async function suspendUserAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(userIdSchema, { userId: formData.get("userId") });
  if (!parsed.success) return { error: "Invalid user." };

  try {
    await suspendUser(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function reactivateUserAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(userIdSchema, { userId: formData.get("userId") });
  if (!parsed.success) return { error: "Invalid user." };

  try {
    await reactivateUser(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  revalidatePath("/admin/users");
  return { success: true };
}

export async function deactivateUserAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(userIdSchema, { userId: formData.get("userId") });
  if (!parsed.success) return { error: "Invalid user." };

  try {
    await deactivateUser(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  revalidatePath("/admin/users");
  return { success: true };
}

const revokeSessionSchema = z.object({ userId: z.string().uuid(), sessionId: z.string().uuid() });

export async function revokeUserSessionAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(revokeSessionSchema, { userId: formData.get("userId"), sessionId: formData.get("sessionId") });
  if (!parsed.success) return { error: "Invalid session." };

  try {
    await revokeUserSession(parsed.data);
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { success: true };
}

const invitationActionSchema = z.object({ userId: z.string().uuid(), invitationId: z.string().uuid(), organizationId: z.string().uuid() });

/** Reuses `invitation-service.ts`'s existing, independently-authorized `resendInvitation()` verbatim — see that file's own doc comment. This is a second UI entry point into the same chokepoint, not a second implementation. */
export async function resendUserInvitationAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(invitationActionSchema, {
    userId: formData.get("userId"),
    invitationId: formData.get("invitationId"),
    organizationId: formData.get("organizationId"),
  });
  if (!parsed.success) return { error: "Invalid invitation." };

  try {
    await resendInvitation({ invitationId: parsed.data.invitationId, organizationId: parsed.data.organizationId });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { success: true };
}

export async function revokeUserInvitationAction(_prevState: UserActionState, formData: FormData): Promise<UserActionState> {
  const parsed = safeParseResult(invitationActionSchema, {
    userId: formData.get("userId"),
    invitationId: formData.get("invitationId"),
    organizationId: formData.get("organizationId"),
  });
  if (!parsed.success) return { error: "Invalid invitation." };

  try {
    await revokeInvitation({ invitationId: parsed.data.invitationId, organizationId: parsed.data.organizationId });
  } catch (error) {
    return { error: toAppError(error).message };
  }
  revalidatePath(`/admin/users/${parsed.data.userId}`);
  return { success: true };
}
