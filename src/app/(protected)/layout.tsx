import Link from "next/link";
import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/config/app";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { logoutAction } from "./actions";

/**
 * Minimal shared chrome for the three placeholder destinations
 * (`/admin`, `/support`, `/dashboard`) — enough to manually verify the
 * auth boundary and role-aware routing end to end. NOT the real
 * Admin/Support/Customer experience (spec section 43) — those are
 * Modules 09/32/20's job, built on `AppShell` (Module 02) once there's
 * real navigation/business content to put in it.
 */
// See (public)/layout.tsx's comment — a route-group-only layout has no
// single concrete URL for `next typegen` to key a `LayoutProps<...>` off.
export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAuthenticatedPage();
  // Module 10 — cheap platform-permission read, purely to decide whether
  // the "Users" nav link renders; every real check still lives at
  // `/admin/users` itself (`resolvePlatformContext()` there, independently
  // — this is display convenience, never the authorization boundary).
  const platformContext = await resolvePlatformContext();
  const canViewUserDirectory = platformContext.permissions.has("users.read");
  // Module 11 — same display-convenience-only reasoning as
  // `canViewUserDirectory` above; the real gate is `/admin/organizations`
  // itself.
  const canViewOrganizationDirectory = platformContext.permissions.has("organizations.read");

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold">{appConfig.name}</span>
          {/* Module 07 — plain text links, not the full AppShell/Sidebar
              (Module 02): that's reserved for the real Admin/Support/
              Customer experience (Modules 09/32/20), same boundary this
              layout's own top comment already documents. */}
          <nav className="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
            <Link href="/organizations" className="hover:text-foreground">
              Organizations
            </Link>
            <Link href="/profile" className="hover:text-foreground">
              Profile
            </Link>
            <Link href="/settings/account" className="hover:text-foreground">
              Account
            </Link>
            {/* Module 09 — the notification center's own full page; the
                bell (below) is the quick-preview surface, not a
                replacement for a real link into it. */}
            <Link href="/notifications" className="hover:text-foreground">
              Notifications
            </Link>
            {/* Module 10 — self-service session management, everyone gets this. */}
            <Link href="/settings/sessions" className="hover:text-foreground">
              Sessions
            </Link>
            {canViewUserDirectory ? (
              <Link href="/admin/users" className="hover:text-foreground">
                Users
              </Link>
            ) : null}
            {canViewOrganizationDirectory ? (
              <Link href="/admin/organizations" className="hover:text-foreground">
                All organizations
              </Link>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <NotificationBell />
          <span className="text-sm text-muted-foreground">{user.email}</span>
          <form action={logoutAction}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
