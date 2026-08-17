import type { DefaultSession } from "next-auth";

/**
 * Module augmentation for Auth.js's types — see auth.ts for where these
 * fields are actually populated. `sessionId` on the JWT is this module's
 * own `UserSession.id` (never Auth.js's own session concept, which this
 * app doesn't use — see auth.ts's top comment); `session.user.id` is the
 * one identity field the client actually receives.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
    /**
     * This module's own `UserSession.id` — not sensitive PII, just an
     * opaque identifier `session-guard.ts` needs server-side to look up
     * revocation state. Present on every server-side `auth()` call;
     * nothing in this app currently passes the session to a client
     * component via `useSession()`, but if one ever does, this field is
     * an internal identifier, not personal data, so exposing it there
     * too is fine.
     */
    sessionId?: string;
  }

  /**
   * Module 10 — a purely transient carrier, NOT persisted on the JWT or
   * `Session` (no augmentation added to either of those for it, unlike
   * `sessionId` above). `authorize()` in `auth.ts` is the only place
   * Auth.js gives this module a real `Request` (and therefore its
   * `user-agent` header) at all; the `jwt` callback's own `user`
   * parameter (Auth.js's own mechanism for "what `authorize()` just
   * returned") is the only way to carry it the one hop from there to
   * `createUserSession()` — real, request-scoped data, never a stored
   * credential.
   */
  interface User {
    userAgent?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sessionId?: string;
  }
}

// `next-auth`'s own `session` callback signature (in @auth/core, which
// next-auth wraps) imports `JWT` from `@auth/core/jwt` directly rather
// than the `next-auth/jwt` re-export above — augmenting only the latter
// left `token.sessionId` untyped (as `{}`) specifically inside the
// `session` callback, even though the same augmentation worked fine in
// the `jwt` callback. Both declarations are needed; this isn't
// redundant, it's two different modules TypeScript treats as unrelated
// declaration-merging targets despite `next-auth/jwt` re-exporting
// `@auth/core/jwt` at the value level.
declare module "@auth/core/jwt" {
  interface JWT {
    sessionId?: string;
  }
}
