"use server";

import { redirect } from "next/navigation";
import { selectOrganization } from "@/lib/tenancy";
import { toAppError } from "@/lib/errors/app-error";

export interface SwitchOrganizationActionState {
  error?: string;
}

/**
 * Organization switching (spec sections 8/36). `organizationId` comes
 * from the submitted form — a client-supplied value, but never trusted
 * as one: `selectOrganization()` independently re-verifies the caller
 * actually holds a real, `ACTIVE` membership in an `ACTIVE` organization
 * before writing the selection cookie (see
 * `lib/tenancy/organization-selection.ts`). Switching never touches
 * `User`/`UserSession` — only this one cookie — so it cannot alter the
 * caller's authenticated identity, just which organization subsequent
 * requests resolve as "current."
 */
export async function switchOrganizationAction(
  _prevState: SwitchOrganizationActionState,
  formData: FormData,
): Promise<SwitchOrganizationActionState> {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || !organizationId) {
    return { error: "No organization selected." };
  }

  try {
    await selectOrganization(organizationId);
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }

  redirect("/organizations");
}
