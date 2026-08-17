import type { Metadata } from "next";
import { ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { roleRepository } from "@/server/repositories/role-repository";
import { CreatePlatformUserForm } from "@/components/users/create-platform-user-form";

export const metadata: Metadata = { title: "Create platform user" };

/**
 * `users.create` (spec section 3) — the only runtime path to platform
 * staff (see `user-management-service.ts:createPlatformUser()`'s own
 * top comment for why the invitation system structurally can't do this).
 * Role options are restricted to `scope === "PLATFORM"` system roles
 * ONLY — the same restriction the service function re-enforces
 * server-side; this is display filtering, not the real authorization
 * boundary.
 */
export default async function CreatePlatformUserPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("users.create")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Create platform user" />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="Creating a platform user requires the users.create permission." />
      </div>
    );
  }

  const roles = await roleRepository.listSystemRoles();
  const platformRoles = roles.filter((role) => role.scope === "PLATFORM").map((role) => ({ id: role.id, name: role.name }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Create platform user"
        description="Provisions a new Alpha Page Rankers staff identity with platform-level access. Not for customers — invite them through their organization instead."
        breadcrumbs={[{ label: "Users", href: "/admin/users" }, { label: "Create" }]}
      />
      <CreatePlatformUserForm roleOptions={platformRoles} />
    </div>
  );
}
