import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { ProfileForm } from "@/app/(protected)/profile/profile-form";

export const metadata: Metadata = { title: "Profile" };

/**
 * Portal's own "Profile" nav destination (Build 26) — reuses the
 * EXISTING, already user-scoped, already-safe `/profile` page's own
 * form/service AS-IS (no `role`/`membershipId`/`organizationId`/
 * password hash ever exposed — see `ProfileForm`'s own doc comment).
 * No `CustomerProfile` table, no parallel profile-write path. Security/
 * sessions live at the existing `/settings/account` and
 * `/settings/sessions` (linked from the Portal nav directly, not
 * duplicated here).
 */
export default async function PortalProfilePage() {
  const { user } = await requireAuthenticatedPage();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Profile" description="Your name and display preferences — not tied to any specific organization." breadcrumbs={[{ label: "Portal", href: "/portal" }, { label: "Profile" }]} />
      <Card className="max-w-xl">
        <CardContent>
          <ProfileForm user={{ name: user.name, timezone: user.timezone, locale: user.locale, avatarUrl: user.avatarUrl }} />
        </CardContent>
      </Card>
    </div>
  );
}
