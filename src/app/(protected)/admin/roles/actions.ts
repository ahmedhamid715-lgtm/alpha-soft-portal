"use server";

import { revalidatePath } from "next/cache";
import { assignRole } from "@/server/services/role-service";
import { toAppError } from "@/lib/errors/app-error";

export interface AssignRoleActionState {
  error?: string;
  success?: boolean;
}

/**
 * The one real mutation this module's demonstration UI exposes (spec
 * section 33 — "do not build generic CRUD screens just to increase page
 * count"). Follows spec section 18's exact pattern: authenticate →
 * resolve authorization context → validate input → authorize → execute
 * — all of it inside `assignRole()` (`role-service.ts`), never trusted
 * from this Server Action's own input alone. This action's only job is
 * translating a form submission into that call and a safe error message
 * back — it holds no authorization logic itself.
 */
export async function assignRoleAction(
  _prevState: AssignRoleActionState,
  formData: FormData,
): Promise<AssignRoleActionState> {
  try {
    await assignRole({
      membershipId: formData.get("membershipId"),
      roleId: formData.get("roleId"),
    });
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  revalidatePath("/admin/roles");
  return { success: true };
}
