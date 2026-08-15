# Configuration

Three files, three different jobs — don't blur them together.

## `src/config/environment.ts` — server-only, validated, secrets allowed

Every server-side environment variable is declared in a Zod schema and
validated **at import time** — if a required variable is missing or
malformed, the app fails to boot with a clear message instead of failing
mysteriously three requests later when something finally reads
`process.env.FOO` and gets `undefined`. Import `serverEnv` from here;
never read `process.env` directly anywhere else in server code.

Guarded by `import "server-only"` — Next.js will throw a build error if
this module is ever pulled into a client bundle, even by accident (see
`security.md`).

Variables Module 01 doesn't yet need are `.optional()` in the schema,
with a comment naming which future module makes them required (e.g.
`AUTH_SECRET` → Module 04, `ANTHROPIC_API_KEY` → Module 33). This is
deliberate: it lets `npm run dev` boot cleanly on a fresh checkout before
every downstream module exists, rather than demanding the full,
eventual set of secrets up front.

**AI providers:** Claude (via the official Anthropic SDK) is the primary
provider. OpenAI was decided as a planned secondary provider during
Module 01 — `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`OPENAI_CHAT_MODEL` are
reserved in the env schema now so it doesn't need revisiting later, but
no OpenAI SDK or integration code exists yet. Module 33 (AI Core) is
where both providers actually get wired up.

## `src/config/environment.public.ts` — client-safe

Only `NEXT_PUBLIC_*` variables. Anything here may end up in the browser
bundle — never move a value from `environment.ts` into this file. Next.js
inlines `NEXT_PUBLIC_*` references at build time via static analysis, so
client components should still reference `process.env.NEXT_PUBLIC_X`
literally; this module exists for server components and utilities that
want a validated, typed view of the same values.

## `src/config/app.ts` — non-secret, centralized app config

Application name, URL, default locale/timezone/currency, and the default
feature-flag values. This is what stops "Alpha OS" / "production" / "USD"
from being scattered as magic strings across the codebase — import
`appConfig` instead of hardcoding.

## `src/config/navigation.ts` — nav schema, currently empty

Defines the `NavItem`/`NavigationConfig` shape future dashboard modules
(09 Admin, 20 Customer, 32 Support) will populate. Empty in Module 01
because no dashboards exist yet — this just establishes that navigation
should be data-driven, not hard-coded JSX scattered across layout files.

## Adding a new environment variable

1. Add it to the Zod schema in `environment.ts` (or `.public.ts` if it's
   genuinely safe for the browser).
2. Document it in `.env.example` under the right category, with a comment
   explaining what it's for and which module needs it.
3. If it's required by an existing feature, don't make it `.optional()` —
   optional is for "not needed yet," not "I don't want to deal with
   validation."
