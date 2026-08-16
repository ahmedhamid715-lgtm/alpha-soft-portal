import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "My profile" };

/**
 * Self-service profile (spec section 24) — deliberately separate from
 * any organization-admin surface: this page never shows or touches
 * `role`, `membershipId`, `organizationId`, or the password hash — see
 * `user-profile-service.ts`'s own comment for why those fields don't
 * even exist to expose here.
 */
export default async function ProfilePage() {
  const { user } = await requireAuthenticatedPage();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="My profile" description="Your name and display preferences — not tied to any specific organization." breadcrumbs={[{ label: "Profile" }]} />
      <Card className="max-w-xl">
        <CardContent>
          <ProfileForm user={{ name: user.name, timezone: user.timezone, locale: user.locale, avatarUrl: user.avatarUrl }} />
        </CardContent>
      </Card>
    </div>
  );
}
