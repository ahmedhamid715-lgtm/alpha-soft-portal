import { NextResponse } from "next/server";
import { auth } from "@/auth";

/**
 * Coarse route protection (spec section 20) — Next.js 16's `proxy.ts`
 * (not `middleware.ts`, see AGENTS.md), running in the Node.js runtime by
 * default here, same as the rest of the app.
 *
 * This is deliberately CHEAP: it only checks whether `auth()` resolves a
 * JWT at all (valid signature, not expired) — it does NOT look up this
 * app's own `UserSession` table to check revocation/account status. That
 * authoritative check lives in `requireAuthenticatedUser()`
 * (`lib/auth/session-guard.ts`), called from every actual protected
 * Server Component/Action/Route Handler. Two reasons, not one:
 *
 *   1. Performance — a DB round trip on literally every request to a
 *      protected-prefix route (including ones that don't end up reading
 *      any data) is wasteful when the real page is about to make its own
 *      DB calls anyway.
 *   2. Principle (spec section 20 again) — "never rely solely on 'the
 *      user couldn't reach the page.'" `proxy.ts` is a UX convenience
 *      (redirect obviously-unauthenticated traffic away early); it is
 *      NOT the security boundary. A revoked session must still be
 *      rejected even if some future code path reaches a Server Action
 *      directly without going through a proxied page render.
 */
const PROTECTED_PREFIXES = ["/admin", "/support", "/dashboard"];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

  if (isProtected && !req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Skip Next.js internals, static assets, and the auth API routes
  // themselves — proxying those would be pure overhead with no security
  // benefit (the auth routes must always be reachable, static assets
  // aren't a protected surface).
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
