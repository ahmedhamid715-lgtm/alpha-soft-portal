import Link from "next/link";
import { appConfig } from "@/config/app";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared shell for every pre-authentication route (login, forgot-
 * password, reset-password, verify-email) — not the full `AppShell`
 * (Module 02), since there's no signed-in identity/organization/nav to
 * render yet. Restrained, branded, centered — the "premium SaaS, not a
 * generic template" bar from Module 02 applies here too (spec section
 * 17), just with a much smaller surface than a dashboard.
 */
// Next.js's route-based typegen (`next typegen`) only produces a
// `LayoutProps<Route>` generic for layouts whose segment corresponds to a
// single concrete URL (see .next/types/routes.d.ts) — a route-group-only
// layout like this one, which applies to several sibling routes
// (/login, /forgot-password, ...) without adding its own URL segment,
// isn't one of those, so `children` is typed directly instead.
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
            A
          </div>
          <span className="text-sm font-semibold">{appConfig.name}</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
    </div>
  );
}
