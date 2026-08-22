import type { Metadata } from "next";
import Link from "next/link";
import { Users, Building2, ShieldCheck, Bell, KeyRound, CreditCard, Tags } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";

export const metadata: Metadata = { title: "Admin" };

const TOOLS = [
  { href: "/admin/users", label: "Users", description: "Platform-wide user directory, lifecycle, sessions.", icon: Users, permission: "users.read" as const },
  { href: "/admin/organizations", label: "Organizations", description: "Every organization, platform-wide. Reactivate a suspended one.", icon: Building2, permission: "organizations.read" as const },
  { href: "/admin/audit", label: "Audit log", description: "Platform-wide security and administrative events.", icon: ShieldCheck, permission: "audit.readPlatform" as const },
  { href: "/admin/notifications", label: "Notification delivery", description: "Delivery status and failures across every organization.", icon: Bell, permission: "notifications.observability" as const },
  { href: "/admin/roles", label: "Roles & permissions", description: "Platform system roles and what each one grants.", icon: KeyRound, permission: "roles.read" as const },
  { href: "/admin/billing", label: "Billing", description: "Platform-wide financial intelligence — MRR, revenue, receivables, financial health.", icon: CreditCard, permission: "billing.analytics.read" as const },
  { href: "/admin/plans", label: "Plans", description: "The platform-wide plan catalog.", icon: Tags, permission: "billing.plan.manage" as const },
];

/**
 * The real admin landing page — previously a bare Module 04 placeholder
 * ("Module 09 builds the real Admin Command Center," a stale comment:
 * Module 09 became Notifications, not this page, in the roadmap's
 * actual numbering). Found broken by actually logging in and looking:
 * platform staff landed here after every sign-in with zero discoverable
 * path to any of the real admin tools Modules 08–11 already shipped
 * (`/admin/audit`, `/admin/users`, `/admin/organizations`,
 * `/admin/notifications`, `/admin/roles` — every one reachable only by
 * typing its exact URL). This page doesn't add any new capability; it
 * just makes the ones that already exist discoverable, filtered to
 * whichever ones this caller actually holds the permission for — same
 * `resolvePlatformContext()`/`context.permissions.has(...)` gating
 * every one of those pages already independently re-checks itself, so
 * a card showing here is never the real authorization boundary, only a
 * convenience (identical reasoning `(protected)/layout.tsx`'s own
 * nav-link visibility already established).
 */
export default async function AdminPage() {
  const context = await resolvePlatformContext();
  const availableTools = TOOLS.filter((tool) => context.permissions.has(tool.permission));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Admin" description="Platform administration — every tool below re-checks your access independently when you open it." />

      {availableTools.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No platform tools available"
          description="Your account has no platform-scope permissions. If you believe this is wrong, ask a platform administrator."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {availableTools.map((tool) => (
            <Card key={tool.href}>
              <CardContent>
                <Link href={tool.href} className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 font-medium">
                    <tool.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    {tool.label}
                  </span>
                  <span className="text-sm text-muted-foreground">{tool.description}</span>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
