import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { can } from "@/lib/authorization/authorize";
import { NewOrganizationForm } from "./new-organization-form";

export const metadata: Metadata = { title: "Create organization" };

/**
 * Organization creation (spec section 28) — `organizations.create` is
 * PLATFORM-scope, held only by `platform_owner`/`platform_admin` (see
 * `roles.ts`): Alpha OS has no public self-service org signup. The real
 * enforcement is `createOrganization()`'s own `requirePermission()` call
 * (`organization-management-service.ts`) — this page-level `can()` check
 * is UX only (spec section 16), so a member without the permission sees
 * an explanatory `EmptyState` instead of a form that would just reject
 * their submission.
 */
export default async function NewOrganizationPage() {
  const allowed = await can("organizations.create");

  if (!allowed) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Create organization" breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "New" }]} />
        <EmptyState
          icon={ShieldAlert}
          title="You don't have access to this page"
          description="Creating an organization requires the organizations.create permission — platform staff only. Alpha OS has no public self-service signup."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Create organization"
        description="Sets up the organization, its first owner membership, and onboarding — atomically."
        breadcrumbs={[{ label: "Organizations", href: "/organizations" }, { label: "New" }]}
      />
      <Card className="max-w-xl">
        <CardContent>
          <NewOrganizationForm />
        </CardContent>
      </Card>
    </div>
  );
}
