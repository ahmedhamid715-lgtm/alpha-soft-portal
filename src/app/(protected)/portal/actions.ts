"use server";

import { redirect } from "next/navigation";
import { selectOrganization } from "@/lib/tenancy";
import { toAppError } from "@/lib/errors/app-error";

export interface PortalActionState {
  error?: string;
}

/**
 * Portal organization switching — reuses the EXISTING, already-verified
 * `selectOrganization()` (Module 06) exactly as `/organizations`'s own
 * `switchOrganizationAction` does; the only difference is where this one
 * redirects back to. See that file's own comment for the full
 * "client-supplied but never trusted" reasoning — identical here.
 */
export async function switchPortalOrganizationAction(_prevState: PortalActionState, formData: FormData): Promise<PortalActionState> {
  const organizationId = formData.get("organizationId");
  if (typeof organizationId !== "string" || !organizationId) {
    return { error: "No organization selected." };
  }

  try {
    await selectOrganization(organizationId);
  } catch (error) {
    return { error: toAppError(error).message };
  }

  redirect("/portal");
}
