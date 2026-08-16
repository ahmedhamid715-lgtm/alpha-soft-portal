import { requireAuthenticatedPage } from "@/lib/auth/session-guard";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/config/app";
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

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <span className="text-sm font-semibold">{appConfig.name}</span>
        <div className="flex items-center gap-3">
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
