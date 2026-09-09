import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { resolvePortalContext } from "@/lib/portal/context";
import { AppShell } from "@/components/layout/app-shell";
import type { NavGroup } from "@/components/layout/app-sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { Button } from "@/components/ui/button";
import { logoutAction } from "./actions";

/**
 * The real navigational shell for every authenticated page — a
 * previously plain text-link header, upgraded to the full `AppShell`/
 * `AppSidebar` (Module 02) once there was enough real navigation to put
 * in one: found broken by actually logging in (not by inspection) —
 * `/admin` had zero discoverable path to any of the platform tools
 * Modules 08–11 already shipped, and the same was true, less severely,
 * for every self-service page (`/profile`/`/settings/account`/
 * `/notifications`/`/settings/sessions`), all reachable only by typing
 * an exact URL. `AppSidebar` was always built role-agnostic — "it has
 * no knowledge of admin vs. support vs. customer... each role-specific
 * module supplies its own NavGroup[]" (its own top comment) — this file
 * is the first real caller, computing ONE shell for every persona
 * rather than three duplicated ones: the "Platform" group is simply
 * omitted for a caller who holds none of its permissions, the same
 * `context.permissions.has(...)` gating every one of those pages
 * already independently re-checks itself (a sidebar entry is never the
 * real authorization boundary, only a convenience).
 */
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuthenticatedPage();
  const platformContext = await resolvePlatformContext();
  // Build 26 — Customer Portal. An empty `eligibleOrganizations` (no
  // ACTIVE membership in an ACTIVE, non-platform organization) hides the
  // whole "Portal" group, the same "hide when nothing to show" pattern
  // `platformItems` already establishes below — a nav entry is never the
  // real authorization boundary (every Portal page/service independently
  // re-verifies via `guardPortalPage()`), only a convenience.
  const portalContext = await resolvePortalContext();
  const hasPortalAccess = portalContext.eligibleOrganizations.length > 0;

  const navGroups: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        { key: "dashboard", label: "Dashboard", href: hasPortalAccess ? "/portal" : "/dashboard", icon: "dashboard" },
        { key: "organizations", label: "Organizations", href: "/organizations", icon: "organizations" },
        { key: "notifications", label: "Notifications", href: "/notifications", icon: "notifications" },
        { key: "sessions", label: "Sessions", href: "/settings/sessions", icon: "sessions" },
      ],
    },
    {
      label: "Account",
      items: [
        { key: "profile", label: "Profile", href: "/profile", icon: "profile" },
        { key: "account", label: "Account", href: "/settings/account", icon: "account" },
        { key: "notification-preferences", label: "Notification preferences", href: "/settings/notifications", icon: "settings" },
      ],
    },
  ];

  if (hasPortalAccess) {
    navGroups.splice(1, 0, {
      label: "Portal",
      items: [
        { key: "portal-company", label: "My Company", href: "/portal/company", icon: "organizations" },
        { key: "portal-services", label: "Services", href: "/portal/services", icon: "services" },
        { key: "portal-projects", label: "Projects", href: "/portal/projects", icon: "projects" },
        { key: "portal-tasks", label: "Tasks", href: "/portal/tasks", icon: "tasks" },
        { key: "portal-reports", label: "Reports", href: "/portal/reports", icon: "reports" },
        { key: "portal-tickets", label: "Tickets", href: "/portal/tickets", icon: "tickets" },
        { key: "portal-messages", label: "Messages", href: "/portal/messages", icon: "messages" },
        { key: "portal-documents", label: "Documents", href: "/portal/documents", icon: "documents" },
        { key: "portal-billing", label: "Billing", href: "/portal/billing", icon: "billing" },
        { key: "portal-notifications", label: "Notifications", href: "/portal/notifications", icon: "notifications" },
        { key: "portal-assistant", label: "AI Assistant", href: "/portal/assistant", icon: "ai" },
        { key: "portal-profile", label: "Profile", href: "/portal/profile", icon: "profile" },
      ],
    });
  }

  const platformItems = [
    { key: "admin-users", label: "Users", href: "/admin/users", icon: "users", permission: "users.read" as const },
    { key: "admin-organizations", label: "All organizations", href: "/admin/organizations", icon: "organizations", permission: "organizations.read" as const },
    { key: "admin-audit", label: "Audit log", href: "/admin/audit", icon: "audit", permission: "audit.readPlatform" as const },
    { key: "admin-notifications", label: "Notification delivery", href: "/admin/notifications", icon: "notifications", permission: "notifications.observability" as const },
    { key: "admin-roles", label: "Roles & permissions", href: "/admin/roles", icon: "roles", permission: "roles.read" as const },
    { key: "admin-billing", label: "Billing", href: "/admin/billing", icon: "billing", permission: "billing.analytics.read" as const },
    { key: "admin-plans", label: "Plans", href: "/admin/plans", icon: "plans", permission: "billing.plan.manage" as const },
    { key: "admin-ai", label: "AI usage", href: "/admin/ai", icon: "ai", permission: "ai.observability" as const },
    { key: "admin-ai-knowledge", label: "Knowledge", href: "/admin/ai/knowledge", icon: "documents", permission: "knowledge.observability" as const },
    // Deliberately flat (no `children`) — `NavMenuItem` (app-sidebar.tsx)
    // renders an item WITH `children` as a `CollapsibleTrigger` BUTTON,
    // not a `<Link>` to its own `href`; giving "CRM" a sub-nav would make
    // clicking it only expand/collapse instead of navigating to
    // `/admin/crm` at all. Found live by Build 19's own Phase 6 E2E run
    // (the sidebar "CRM" link genuinely didn't exist), not by
    // inspection — same single-link pattern "Knowledge" already uses;
    // company/contact/lead/task/settings sub-pages stay reachable via
    // the CRM dashboard's own links instead of a sidebar sub-menu.
    { key: "admin-crm", label: "CRM", href: "/admin/crm", icon: "crm", permission: "crm.read" as const },
  ].filter((item) => platformContext.permissions.has(item.permission));

  if (platformItems.length > 0) {
    navGroups.push({ label: "Platform", items: platformItems });
  }

  const roleLabel = platformContext.role?.name ?? "Workspace";

  return (
    <AppShell
      roleLabel={roleLabel}
      navGroups={navGroups}
      topNavEnd={
        <div className="flex items-center gap-3">
          <NotificationBell />
          <span className="hidden text-sm text-muted-foreground sm:inline">{user.email}</span>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
