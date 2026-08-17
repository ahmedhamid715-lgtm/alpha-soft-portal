import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verifyCredentials, createUserSession } from "@/server/services/auth-service";
import { sessionRepository } from "@/server/repositories/session-repository";

/**
 * Alpha OS's Auth.js (NextAuth v5) configuration — see
 * docs/architecture/authentication.md for the full architecture writeup.
 * Summary of the decisions this file encodes:
 *
 * - **No adapter.** Auth.js's `PrismaAdapter` exists to manage OAuth
 *   Account linking and adapter-owned Session/VerificationToken tables —
 *   none of which this module needs yet (no OAuth provider, and the
 *   Credentials provider can't use the database session strategy the
 *   adapter would enable anyway — see below). `authorize()` queries our
 *   own `userRepository`/`credentialRepository` directly. Adding
 *   `PrismaAdapter` later (once an OAuth provider needs Account linking)
 *   is additive, not a rewrite of this file.
 * - **JWT session strategy — not by preference, by constraint.** Auth.js
 *   throws `UnsupportedStrategy` if a Credentials provider is configured
 *   without `session.strategy: "jwt"` — the database strategy is simply
 *   not an option here. JWT alone gives no server-side revocation, which
 *   the spec explicitly requires (logout-everywhere, revoke-after-
 *   password-reset, admin revocation) — this module's own `UserSession`
 *   table (not Auth.js's) is what actually provides that: a `sessionId`
 *   is minted and stored there at sign-in, embedded in the JWT, and
 *   `requireAuthenticatedUser()` (`lib/auth/session-guard.ts`) checks
 *   that row — not just the JWT's signature/expiry — before treating a
 *   request as authenticated.
 * - **One config file, not split into `auth.config.ts` (edge) +
 *   `auth.ts` (Node).** That split exists in most Auth.js v5 guides to
 *   keep an edge-runtime proxy free of Node-only code (like a Prisma
 *   client). Next.js 16 changed `proxy.ts`'s default runtime to Node.js
 *   (see AGENTS.md / docs/architecture/platform-core.md) — this app's
 *   proxy already runs in the same runtime as everything else, so the
 *   split has no purpose here.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const identity = await verifyCredentials(credentials);
        if (!identity) return null;
        // Auth.js's User type wants `id` as the only required field;
        // `email`/`name` ride along for the jwt callback's `user` param
        // below. No password/hash ever touches this return value.
        // `userAgent` (Module 10 — see types/next-auth.d.ts's own doc
        // comment) is the one place this module ever sees the real
        // `Request` — `authorize()`'s second parameter, which no other
        // callback receives. Truncated the same defensive way
        // `createUserSession()` already truncates it on write; capturing
        // the full untruncated header here would just move the same
        // "don't let an oversized header value do anything surprising"
        // concern one hop earlier for no benefit.
        return { ...identity, userAgent: request.headers.get("user-agent")?.slice(0, 255) ?? null };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // How often `jwt`'s `trigger` fires as "update" on an otherwise
    // unchanged token — bounds how stale `UserSession.lastActiveAt`
    // writes can get without writing to the database on every request.
    updateAge: 24 * 60 * 60, // 24 hours
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user?.id && trigger === "signIn") {
        // Fresh sign-in — `user` is what `authorize()` returned. Mint our
        // own session row and carry its id in the token; nothing else
        // identity-related goes into the JWT (see spec section 7 — "do
        // not put unnecessary personal/business data into the session").
        token.sessionId = await createUserSession(user.id, user.userAgent ?? null);
        token.sub = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      // Deliberately minimal. Organization/membership/role context is
      // resolved server-side, fresh, per request via
      // `getCurrentMembership()` — never cached in the JWT, since a
      // user's memberships can change between requests and a stale JWT
      // claim would be wrong until the token's next refresh.
      if (token.sub) session.user.id = token.sub;
      if (token.sessionId) session.sessionId = token.sessionId;
      return session;
    },
  },
  events: {
    async signOut(message) {
      // `message.token` (JWT strategy, our case) vs. `message.session`
      // (database strategy, unused here) — see auth.ts's top comment for
      // why this app is on JWT strategy.
      const sessionId = "token" in message ? message.token?.sessionId : undefined;
      if (typeof sessionId === "string") {
        await sessionRepository.revoke(sessionId, "user_logout");
      }
    },
  },
});
