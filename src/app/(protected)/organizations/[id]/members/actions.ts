"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assignRole } from "@/server/services/role-service";
import { removeMember, updateMemberStatus } from "@/server/services/membership-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

export interface MemberActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  success?: boolean;
}

const assignRoleSchema = z.object({ organizationId: z.string().uuid(), membershipId: z.string().uuid(), roleId: z.string().uuid() });

/**
 * Every real check (`members.update`, scope compatibility, last-owner
 * protection) lives in `assignRole()` (`role-service.ts`) — the exact
 * same chokepoint `/admin/roles` uses (spec section 17: "do not
 * recreate role logic"). This action only revalidates a different page.
 */
export async function assignMemberRoleAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = safeParseResult(assignRoleSchema, {
    organizationId: formData.get("organizationId"),
    membershipId: formData.get("membershipId"),
    roleId: formData.get("roleId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await assignRole({ membershipId: parsed.data.membershipId, roleId: parsed.data.roleId });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/members`);
  return { success: true };
}

const memberStatusSchema = z.object({ organizationId: z.string().uuid(), membershipId: z.string().uuid(), status: z.enum(["ACTIVE", "SUSPENDED"]) });

export async function updateMemberStatusAction(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = safeParseResult(memberStatusSchema, {
    organizationId: formData.get("organizationId"),
    membershipId: formData.get("membershipId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await updateMemberStatus({ membershipId: parsed.data.membershipId, status: parsed.data.status });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/members`);
  return { success: true };
}

const removeMemberSchema = z.object({ organizationId: z.string().uuid(), membershipId: z.string().uuid() });

export async function removeMemberAction(_prevState: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const parsed = safeParseResult(removeMemberSchema, {
    organizationId: formData.get("organizationId"),
    membershipId: formData.get("membershipId"),
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    await removeMember({ membershipId: parsed.data.membershipId });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath(`/organizations/${parsed.data.organizationId}/members`);
  return { success: true };
}
