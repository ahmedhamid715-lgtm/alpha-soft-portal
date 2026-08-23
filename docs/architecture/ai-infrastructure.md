# AI infrastructure & intelligence foundation (Module 17)

A real, working AI support-chat capability — the Anthropic Claude API,
through a real provider abstraction, wired end-to-end into a
conversational assistant reachable from any organization member with
`ai.use`. Not a demo, not a mock, not a "coming soon" page: every piece
of infrastructure this document describes (permissions, RLS, audit,
rate limiting, cost tracking) exists because a real capability needs
it, and every piece is exercised by a real test.

## What this module is, and is not

**Is**: a conversational assistant a member of a subscribing
organization can use to ask general questions about Alpha OS — how
billing works, how to change a plan, general platform help. Real,
multi-turn, persisted conversation history.

**Is NOT**:

- **Not grounded in the requesting organization's own live account
  data.** No tool use, no function calling into this platform's own
  data (subscription status, invoices, member list, ticket contents).
  The system prompt (`lib/ai/system-prompt.ts`) explicitly instructs
  the assistant to say so rather than guess when asked something that
  would require that access. This is a deliberate scope boundary, not
  an oversight — see "Why no account-data grounding" below.
- **Not an agent that takes action.** It cannot change settings, cancel
  a subscription, issue a refund, or modify any data. `AIActionCard`
  (`components/shared/ai-chat.tsx`, built by Module 02) is the visual
  primitive a FUTURE tool-confirmation system would use — not wired to
  anything in this module.
- **Not a human support/ticketing system.** `tickets.*` permissions
  remain reserved for a future Support module (rbac.md's own "Module 30
  (Support)" note) — this module never touches them, and the AI
  assistant here never hands off to or coordinates with a human agent.
- **Not streaming.** A single, real, non-streaming request/response
  round trip per turn — see "Known limitations."

## Why no account-data grounding

Answering "why is my invoice overdue" correctly would require the
assistant to read the requesting organization's real billing data via
tool/function calling — genuinely useful, and genuinely a much larger,
more security-sensitive surface: every tool call would need to
independently re-derive and enforce the SAME tenant/permission
boundaries this module's own RLS/authorization already do for direct
reads, with a new class of risk (a cleverly-worded prompt attempting to
make the model call a tool with parameters that leak another
organization's data) that deserves its own dedicated adversarial
testing effort, not a rushed addition to a foundation module. Deferred,
not abandoned — a real, valuable future module, explicitly out of
scope here.

## Architecture

```text
UI (organizations/[id]/assistant/*, admin/ai)
  -> Server Action (actions.ts)
  -> ai-conversation-service.ts / ai-observability-service.ts
  -> requirePermission() (ai.use / ai.manage / ai.observability)
  -> ai-conversation-repository.ts (RLS-protected)
  -> lib/ai/provider/anthropic/provider.ts
  -> @anthropic-ai/sdk -> Anthropic API
```

Mirrors Module 13's billing provider abstraction exactly:
`lib/ai/provider/types.ts` (provider-agnostic shapes),
`lib/ai/provider/interface.ts` (the `AiChatProvider` contract),
`lib/ai/provider/anthropic/` (the one real implementation — `client.ts`
owns the SDK instantiation, `provider.ts` is the only other file that
imports `@anthropic-ai/sdk`).

## Data model

| Model | Ownership | RLS | Lifecycle |
|---|---|---|---|
| `AiConversation` | Organization-owned (direct `organization_id`) AND user-owned (`user_id`, the starter) | Standard tenant-isolation policy (SELECT/INSERT/UPDATE); no DELETE policy | Never deleted — `status` (`OPEN`/`CLOSED`) tracks lifecycle, same "archive, don't destroy" discipline as `Organization`/`User`. |
| `AiMessage` | Transitively organization-owned (via `conversation_id` → `organization_id`) | `EXISTS`-subquery SELECT/INSERT; no UPDATE/DELETE policy | Immutable — a chat transcript, like an audit event, is never revised after the fact. |

No new table for usage/cost tracking — real Anthropic response fields
(`model`, `inputTokens`, `outputTokens`, `costMinorUnits`, `latencyMs`,
`providerMessageId`) are denormalized directly onto the `ASSISTANT`
`AiMessage` row (`null` for `USER` messages) — one real API call maps
to exactly one `ASSISTANT` message, so a separate table would be a
needless 1:1 join with no independent lifecycle (contrast Module 16's
`InvoiceLineItemTax`, which genuinely needs its own table because one
line item can carry multiple simultaneous tax components).

## Tenant model — two owners, two boundaries

RLS enforces the ORGANIZATION boundary (never cross-tenant) — the same
mechanism every other tenant-scoped table in this codebase uses. Within
that boundary, a FINER rule applies at the application layer: only the
conversation's own `userId`, or a caller holding `ai.manage`
(organization-wide oversight), may view or close it; only the owner may
ever POST a new message into it — `ai.manage` is oversight, never
impersonation. This "RLS for tenant isolation, service layer for
finer within-tenant business rules" split is the same layering
Module 10's own user-detail activity panel already established — RLS
is not the right tool for a rule that depends on WHICH permission the
caller holds, only on WHICH organization the row belongs to.

Every write path re-verifies `conversationId`'s real `organizationId`
and `userId` server-side inside the tenant-scoped transaction — a
client-supplied `conversationId`/`organizationId` pair is a hint, never
trusted alone. Proven directly: `ai-conversation-service.test.ts`'s own
cross-user and cross-tenant tests, and `ai-rls.test.ts`'s direct
database-level proofs (including a zero-WHERE `findMany({})` under a
non-owning organization's context, and the two-hop transitive proof for
`AiMessage`).

## Authorization

Three permissions — `ai.use`/`ai.manage` reserved by Module 05 (with
its own "Module 17/33" numbering ambiguity, now resolved), `ai.observability`
new this module. See `billing-reporting-security.md`-style reasoning,
reused for a non-billing domain: mirrors the exact tiered-risk pattern
Module 15's own `billing.analytics.read`/`billing.controls.read` split
established, applied here.

| Key | Scope | Grants |
|---|---|---|
| `ai.use` | ORGANIZATION | Start/continue a conversation. Granted to `owner`/`admin`/`member` (via `ORGANIZATION_FULL` + an explicit `member` addition) — NOT `viewer` (read-only by design) or `customer` (a different, nested-tenant concept unrelated to needing Alpha OS platform support). |
| `ai.manage` | ORGANIZATION | View every conversation in the organization (oversight) and close any of them. Never lets the holder POST as someone else. Granted via `ORGANIZATION_FULL` (`owner`/`admin`). |
| `ai.observability` | PLATFORM | Aggregate usage/cost across every organization — operational metadata only, never any organization's actual conversation content. Mirrors `notifications.observability` exactly: granted to `platform_owner`/`platform_admin` (via `PLATFORM_FULL`) and `support_admin` explicitly. |

## Audit

Reuses Module 08 exclusively — a new `AI` `AuditCategory` (own
filterable category, same reasoning `BILLING` already established), and
three actions: `ai.conversation.started`, `ai.conversation.closed`,
`ai.rate_limit.exceeded`. Individual MESSAGES are deliberately NOT
audited — `AiMessage` is already the full, durable, RLS-protected
transcript; duplicating it into the audit log would be a second copy of
the same evidence, not a new one. The same "audit the outcome, not
every routine action" discipline Module 15/16's own reconciliation-
divergence and export-audit entries already established.

## Rate limiting & cost protection

`aiRateLimiter` (`lib/platform/rate-limit.ts`) — the same
`InMemoryRateLimiter` class `authRateLimiter`/`invitationRateLimiter`/
`notificationRateLimiter` already use, a new instance/key namespace, 30
messages/hour per ORGANIZATION (the real cost-bearing unit, not per
user). A denial is audited (`ai.rate_limit.exceeded`) and never reaches
the provider — proven directly by
`ai-conversation-service.test.ts`'s own rate-limit test, which asserts
the provider mock's call count never increases past the limit.

**Known limitation, honestly disclosed** (same as `authRateLimiter`'s
own doc comment): in-memory, single-process — resets on restart, and
doesn't coordinate across multiple server instances. Real for this
deployment's current single-instance shape; the same "swap in a
Redis-backed implementation behind the SAME `RateLimiter` interface the
moment a module needs it, without touching call sites" story every
other rate limiter in this codebase already tells.

## Cost estimation — an honest limitation

`lib/ai/pricing.ts`'s `computeCost()` is REAL, deterministic, integer-
only arithmetic over REAL token counts the provider actually returns —
never a fabricated number. The per-model RATE TABLE, however, is
ILLUSTRATIVE: this codebase has no verified, live source for
Anthropic's current published per-token pricing, and hardcoding a
possibly-wrong number as fact would itself be exactly the "fake
financial data" this platform's own conventions forbid (the same
"never fake tax rates" reasoning `tax-compliance.md` establishes for a
different domain). An operator MUST confirm and update `PRICING_TABLE`
against Anthropic's actual current pricing before this figure is used
for any real financial decision. Every UI surface showing this number
says "estimated cost," never bare "cost."

## Concurrency & idempotency

No new concurrency-sensitive MUTATION surface: every write happens in a
short `withTenantContext()` transaction, and the ONE external network
call (the Anthropic API request) is made OUTSIDE any transaction — the
exact same "create local state, call the provider, reconcile after"
shape `subscription-service.ts`'s own `startCheckoutForPlanPrice()`
already establishes for Stripe (spec's own "never hold a transaction
open across an external network call" rule). If the provider call
fails, the caller's own `USER` message remains persisted — real data,
independent of whether the assistant could reply — and the error
propagates as a safe `ExternalServiceError`, proven directly by a
dedicated integration test. No retry-triggered duplication risk exists
because nothing in this module auto-retries a failed provider call;
a user who wants to try again explicitly resubmits, creating a new,
independently-real message.

## Real bugs found and fixed during this module's own testing

### A session-wide accessibility testing methodology gap

**`page.emulateMedia({ colorScheme })` — the mechanism EVERY
accessibility spec in this codebase uses to switch light/dark — has NO
EFFECT on this app's actual rendered theme.** `ThemeProvider`
(`components/theme-provider.tsx`) configures `next-themes` with
`enableSystem={false}`; next-themes' own injected blocking script only
ever consults `matchMedia('(prefers-color-scheme: dark)')` when
`enableSystem` is true. With it false, the theme is ALWAYS whatever
`localStorage['theme']` holds, defaulting to `defaultTheme="dark"` when
unset (a fresh Playwright context has no `localStorage`). Confirmed
directly: the raw server-rendered HTML carries no theme class at all,
and next-themes' own minified blocking script (inspected directly)
gates its `matchMedia` branch behind `enableSystem`.

**Practical effect**: every "(light)" `emulateMedia`-driven scan across
this whole codebase has actually been re-scanning dark mode a second
time, not light mode — real, pre-existing (predates Module 17
entirely), not introduced here. Fixed in THIS module's own specs
(`ai-assistant-accessibility.spec.ts`) by setting
`localStorage['theme']` directly via `page.evaluate()` — the real
mechanism the actual `ThemeToggle` component's `setTheme()` call
ultimately writes to — before each navigation. NOT retroactively fixed
in Modules 04–16's own already-completed accessibility specs (a
massive, out-of-scope rewrite of many other modules' test files); see
the completion report for the explicit recommendation this deserves a
dedicated follow-up pass.

### Two real WCAG AA contrast violations, only found once light mode was genuinely tested

1. **`--light-text-muted` (the `text-muted-foreground` token,
   `globals.css`)** measured 4.49:1 (below 4.5:1) for text sitting
   directly on `--light-bg` (`#faf9fc`, the page background) — a
   PageHeader description, not inside a Card. A prior fix (Module 04)
   had verified this same color against `--light-surface` (pure white
   Card backgrounds, `#ffffff`) at 4.72:1, a real margin — but never
   against the slightly-darker page background itself, since (per the
   finding above) light mode was never actually exercised again after
   that fix shipped. Fixed by darkening the token further
   (`#77717f` → `#6d6775`), verified by direct WCAG luminance
   calculation to clear BOTH real light-mode surfaces with a genuine
   margin (5.20:1 against `--light-bg`, 5.46:1 against
   `--light-surface`), not just the one that happened to be checked
   last time.

2. **The shared `Button` component's default variant, dark-mode
   hover state.** `hover:bg-primary/80` measured ~4.1:1 (below 4.5:1)
   in dark mode. A genuinely thorough investigation was required here
   because the FIRST fix attempt (`dark:hover:bg-primary/90`, the same
   fix DIRECTION the `destructive` variant's own pre-existing comment
   in that file documents for an identical root cause) did NOT resolve
   the axe-core failure, which kept citing the OLD unscoped rule
   regardless. Direct, live investigation (not just re-reading CSS)
   established the FULL picture:
   - `color-mix(..., transparent)` (what `/80` and `/90` both compile
     to) produces a genuinely SEMI-TRANSPARENT color, not a
     pre-flattened solid one — its effective on-screen result still
     depends on whatever sits behind the button. No fixed opacity
     fraction is reliably safe against an unknown backdrop.
   - The REAL fix: mix toward an OPAQUE color (black), never
     `transparent` — `dark:hover:bg-[color-mix(in_oklab,var(--primary)_85%,black)]`.
     Verified DIRECTLY, twice independently (real `.hover()`
     interaction + `getComputedStyle`; canvas pixel-sampling of the
     resulting sRGB value): the real, live, hovered button renders at
     9.11:1 against white text — a large, genuine margin, matching how
     the `destructive` variant's own OWN fix (a solid `dark:bg-destructive`
     fill) already established this exact pattern for an identical
     root cause.
   - Even after that fix was PROVEN correct via direct DOM/CDP
     inspection, axe-core's own `color-contrast` check STILL flagged
     it in one specific scan (immediately after a real `.click()`) —
     traced to axe-core evaluating multiple statically-discovered
     hover CSS rules for an element independently, rather than
     resolving which one actually wins the cascade; a known category
     of axe-core limitation for compound modern CSS selectors, not a
     real defect (proven: `button.matches(':hover')` is directly
     confirmed `false` after the mouse moves away, and the button's
     real computed background at that point is the plain, unblended
     `--primary` at 6.75:1 — comfortably passing on its own). Documented
     and narrowly excluded from that one scan
     (`scanExcludingVerifiedHoverFalsePositive()` in
     `ai-assistant-accessibility.spec.ts`) — the same
     "verify directly, don't just dismiss" discipline
     `user-org-management-accessibility.spec.ts`'s own `scanPopup()`
     (a different, Radix-Portal-related axe false positive) already
     established in this codebase.

Both fixes verified safe app-wide via a full regression sweep across
every accessibility spec in the codebase (both are shared-component/
shared-token changes) — see the completion report for the exact
results.

## Performance

Every real read/write in this module operates on a SINGLE conversation
or a bounded page of conversations (`limit`-capped cursor pagination) —
no unbounded scan. The one platform-wide aggregate
(`getPlatformAiUsageSummary()`) is bounded to a single requested period
and only touches `ASSISTANT` messages within it (`createdAt` range
filter, indexed via `ai_messages(conversation_id, created_at)` — a
period-bounded scan, not a full-table one). This dev environment's
fixture data is far too small for meaningful query-plan analysis at
production scale; stated honestly rather than claimed.

## Known limitations

- **No streaming.** A real, deliberate v1 scope decision — see "What
  this module is, and is not." A future enhancement would need a
  Route Handler + SSE, not a plain Server Action.
- **No account-data grounding / tool use.** See "Why no account-data
  grounding" above.
- **Cost figures are estimates from an illustrative pricing table.**
  See "Cost estimation" above.
- **Rate limiting is in-memory, single-instance.** See "Rate limiting"
  above.
- **Only one provider is implemented.** OpenAI's env vars remain
  reserved (Module 01) but unused — no real second caller exists yet to
  justify building a second adapter against `AiChatProvider`.
- **No conversation search, archival export, or admin-initiated
  deletion.** A conversation can be closed but never removed — genuine
  scope for a future module if a real retention/export requirement
  emerges (this module makes no promise about how long conversation
  history is retained beyond "not deleted").
