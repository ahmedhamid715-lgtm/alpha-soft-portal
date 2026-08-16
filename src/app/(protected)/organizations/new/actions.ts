"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createOrganization } from "@/server/services/organization-management-service";
import { toAppError } from "@/lib/errors/app-error";
import { safeParseResult } from "@/lib/validation/parse";

const formSchema = z.object({
  name: z.string().min(1).max(200),
  displayName: z.string().min(1).max(200),
  slug: z.string().min(2).max(63),
  ownerEmail: z.string().email(),
  ownerName: z.string().min(1).max(200),
  timezone: z.string().optional(),
  currency: z.string().length(3).optional(),
});

export interface CreateOrganizationActionState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
  created?: { id: string; displayName: string; slug: string };
}

/**
 * Translates the form submission into `createOrganization()`
 * (`organization-management-service.ts`) — every real check (the
 * `organizations.create` PLATFORM-scope permission, slug uniqueness, the
 * atomic org+owner+onboarding transaction) lives there, not here. This
 * action only shapes the form data and turns a thrown `AppError` into a
 * safe message.
 *
 * Deliberately does NOT redirect to `/organizations/{id}/onboarding` on
 * success — found by this module's own E2E testing, not by inspection:
 * the platform-staff caller who creates an organization has no
 * MEMBERSHIP in it at all (only the newly-invited owner does), so
 * `resolveOrganizationContext()` correctly resolves zero permissions for
 * them there and the onboarding page 404s. Onboarding is the new OWNER's
 * flow, experienced when *they* first sign in — not the platform
 * operator who provisioned the organization on their behalf (spec
 * section 33: platform access to tenant data must stay explicitly
 * authorized, not a casual grant just to make this redirect resolve).
 * This action returns a plain success confirmation instead.
 */
export async function createOrganizationAction(
  _prevState: CreateOrganizationActionState,
  formData: FormData,
): Promise<CreateOrganizationActionState> {
  const parsed = safeParseResult(formSchema, {
    name: formData.get("name"),
    displayName: formData.get("displayName"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
    ownerName: formData.get("ownerName"),
    timezone: formData.get("timezone") || undefined,
    currency: formData.get("currency") || undefined,
  });
  if (!parsed.success) return { fieldErrors: parsed.fieldErrors };

  try {
    const result = await createOrganization({
      organization: {
        name: parsed.data.name,
        displayName: parsed.data.displayName,
        slug: parsed.data.slug,
        ...(parsed.data.timezone ? { timezone: parsed.data.timezone } : {}),
        ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
      },
      owner: { email: parsed.data.ownerEmail, name: parsed.data.ownerName },
    });

    revalidatePath("/organizations");
    return { created: { id: result.organization.id, displayName: result.organization.displayName, slug: result.organization.slug } };
  } catch (error) {
    const appError = toAppError(error);
    return { error: appError.message };
  }
}
