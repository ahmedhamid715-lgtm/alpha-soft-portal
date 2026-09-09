# Customer Portal

Build 26 — Roadmap Module 20. The **first true customer-facing
application surface** in Alpha OS — every prior page (`/admin/**`,
`/organizations/[id]/**`) is used by Alpha Page Rankers' own internal
staff or by an organization's own internal management surface; `/portal`
is what an external customer (an organization that came through, or
could come through, Alpha Page Rankers' own sales pipeline) uses
directly. Roadmap Module 21 (Project Management) is next and was **not**
started by this build.

## Core thesis: customer-safe projections, never internal DTOs with fields hidden

**The single most important rule this build follows: Customer Portal
uses explicit customer-safe projections. It never exposes an internal
CRM/Customer 360/Client Success object and relies on the frontend to
hide sensitive fields.**

```
Source domain (CRM, billing, notifications, AI, ...)
      │
      ▼
Authorization (session → membership → tenant context → permission)
      │
      ▼
A dedicated Portal service function — reshapes into a NEW, narrower type
      │
      ▼
Portal page (server-rendered)
```

Every `src/server/services/portal/*.ts` file returns its OWN interface
(`PortalDashboard`, `PortalCompanyProfile`, `PortalServices`,
`PortalDocuments`, ...) — never an internal type re-exported with a
comment saying "don't render field X." Where an existing service's
output was ALREADY customer-appropriate (billing, notifications,
profile — see below), Portal calls that service directly rather than
wrapping it in a needless second projection; where it was NOT (CRM data
platform-owned by Alpha Page Rankers), Portal built a real, narrow
projection service.

## Threat model

Internal Alpha Page Rankers CRM/admin access and Customer Portal access
are fundamentally different security contexts, and this build never
lets them touch. A Portal caller:

- never holds a PLATFORM-scope permission (`crm.read`, `crm.onboarding.read`,
  `billing.readPlatform`, ...) — Portal grants exactly one new
  ORGANIZATION-scope permission, `portal.access` (see "Authorization").
- never reaches a page under `/admin/**`.
- never receives an internal CRM DTO, even partially.

The specific facts a Portal caller must **never** see, from any Portal
page or service, under any circumstance: CRM notes/internal activities,
sales pipeline/deal probability/forecasts, internal deal history,
Client Success health score/churn-risk classification, internal
expansion opportunities, management-attention flags, internal audit
events, internal onboarding requirements/checklist items/intake
responses (as individual records — only the aggregate status/progress
is customer-safe), internal staff assignments, staff-only
pricing/admin metadata, internal notification events, operational
security data. None of `src/server/services/portal/**` or
`src/app/(protected)/portal/**` imports `client-success.ts`,
`crm-client-success-*`, `customer-360-service.ts`, or any
platform-only CRM service — grep confirms this, and the Codex Security
Engineer review independently verified it (see "Security").

## Eligibility

A Portal user must have: a valid authoritative session
(`requireAuthenticatedPage()`/`getCurrentUser()` — the SAME Module 04
machinery every other protected page uses), an active `User`, an
ACTIVE `OrganizationMembership`, in an ACTIVE, non-platform
`Organization` (`isPlatform: false`).

**`CrmContact` is never consulted for eligibility, and never will be.**
A CRM contact record with a matching email is not evidence of anything
— eligibility is decided entirely by real `OrganizationMembership` rows.
See "Contact/User linkage" below for why this build introduces no
linkage between the two at all.

`resolvePortalContext()` (`src/lib/portal/context.ts`) is the one place
this is decided: it lists every ACTIVE membership the caller holds in
an ACTIVE, non-platform organization (`membershipRepository.listForUser()`,
a real DB read — never inferred). `guardPortalPage()`
(`src/lib/portal/guard.ts`) is the shared per-page gate every
`/portal/**` page calls, adding one more requirement: the resolved
organization's role must actually grant `portal.access` (a real,
if rare, gap — a pre-RBAC seed account with a null `roleId`, or a
future custom organization role that deliberately omits this
permission, both correctly land on the "denied" state, not silent
access — proven in `tests/e2e/portal.spec.ts`).

## Organization membership requirement

Mandatory, never optional. A user with zero eligible memberships sees
an honest "No organization access yet" empty state on every
`/portal/**` page (via `PortalGateState`) — never a redirect loop, never
a 500, never a page that silently renders nothing.

## Multi-organization behavior

Alpha OS already supports a user belonging to multiple organizations
(Module 06). Customer Portal reuses the EXISTING, already-validated
organization-selection cookie (`lib/tenancy/organization-selection.ts`
— `getSelectedOrganizationId()`/`selectOrganization()`) rather than
inventing a second mechanism:

- Exactly one eligible organization → auto-selected, no picker shown.
- Two or more eligible organizations, no (or a stale/invalid) cookie
  selection → `resolvePortalContext()` returns `organizationId: null`,
  and every page renders `PortalOrganizationPicker` — one row per
  eligible organization, each its own tiny form submitting to
  `switchPortalOrganizationAction()`, which calls the EXISTING
  `selectOrganization()` (re-verifies real, ACTIVE membership before
  writing the cookie — a forged/stale org name is simply rejected, the
  same protection the original `/organizations` switcher already has).
- The cookie is a hint only, never a trust boundary — every downstream
  read still re-derives real authorization via
  `resolveOrganizationContext(organizationId)`, which independently
  re-verifies the membership every single time. Switching organizations
  never modifies `User`/`UserSession` — only this one cookie.

Proven in `tests/e2e/portal.spec.ts` ("Customer Portal —
multi-organization") using the existing `multiorg@alpha-os.test` seed
account (admin in Acme Corp, viewer in Beta Industries).

## Authorization

**No PLATFORM-scope `crm.*` permission is ever checked for, or granted
to, a Portal caller.** Existing ORGANIZATION-scope permissions are
reused wherever they already express exactly what's needed:

| Portal section | Permission | Reused from |
|---|---|---|
| Baseline Portal access + CRM-linked sections (Company's CRM-link flag, Services, Documents, Onboarding status) | `portal.access` (NEW) | — |
| My Company — member roster | `members.read` | Module 07 |
| My Company — profile edit | `organizations.update` | Module 07 |
| Billing / Invoices / Payments | `billing.read` | Module 13 |
| "Manage payment method" (Stripe billing portal) | `billing.manage` | Module 13 |
| AI Assistant | `ai.use` (own conversations), `ai.manage` (oversight) | Module 17 |
| Notifications | (none — recipient-owned, same as `/notifications`) | Module 09 |
| Profile / Account / Sessions | (none — self-owned) | Module 04/07 |

**`portal.access`** (`src/lib/authorization/permissions.ts`) is the
ONE new permission this build introduces — deliberately narrow, not a
blanket "can see everything in Portal." It gates baseline access plus
the genuinely NEW customer-facing CRM-linked surface (Company/Services/
Documents/Onboarding status); every other section keeps using its own
existing, already-correct permission. Granted to all six ORGANIZATION-
scope system roles (`owner`, `admin`, `manager`, `member`, `viewer`,
`customer`) in `src/lib/authorization/roles.ts` — every ordinary
organization member is eligible, section-level detail is what
differentiates owner/admin (full access) from member/viewer (narrower,
via the permissions they individually hold).

The pre-existing `customer` system role predates this build and
describes a DIFFERENT concept — a tenant organization's OWN external
client (e.g. of its own tickets/projects), not an Alpha-Page-Rankers
customer. Alpha Page Rankers' own Portal users are ordinary
owner/admin/manager/member/viewer members of THEIR OWN converted
organization (see "Route architecture" for why `owner`/`admin` also
keep their existing `/organizations/[id]` destination).

## Internal ↔ customer data boundary — the CRM bridge

Build 19–25's own `crm_*` tables are RLS-protected with policies that
require `tenant_is_platform_context()` (e.g.
`crm_client_onboardings`' own `tenant_isolation_select` policy:
`organization_id = tenant_current_organization_id() AND
tenant_is_platform_context()`) — structurally correct, since these
tables are owned exclusively by the platform organization, never by a
customer's own tenant context. This means a customer's own tenant
context (`isPlatformStaff: false`) can **never** read a `crm_*` row
directly, by RLS design — exactly the internal/customer boundary this
build must respect, but it also means Portal's own explicit scope
(showing a customer their real onboarding progress / accepted proposal
/ contract) needs a deliberate bridge.

`src/server/services/portal/portal-crm-bridge.ts` is that bridge, and
the single most security-sensitive file in this build:

1. Every exported function assumes its `customerOrganizationId`
   parameter was **already independently verified** by the caller via
   `resolveOrganizationContext()`/`resolvePortalContext()` — real,
   active membership, not a raw, unverified id. Nothing in this file
   performs that check itself.
2. Only after that verification has already happened elsewhere does a
   Portal service open its OWN short-lived, elevated
   `{ isPlatformStaff: true }` transaction (mirroring
   `resolveCrmScope()`'s own construction in `crm-shared.ts`) to read
   `crm_*` tables, filtering every query by the ALREADY-VERIFIED
   organization id — never by a second, separately-trusted parameter.
3. `resolvePortalCrmCompany()` resolves the `CrmCompany` a customer
   organization converted FROM (`convertedToOrganizationId` — the same
   canonical bridge Build 23/24 established), returning `null` for an
   organization that never went through CRM conversion — an honest,
   expected, non-error state, not "not found."

This pattern was reviewed adversarially by a Codex Security Engineer
(see "Security") specifically for whether it can ever be reached with
an unverified/forged organization id — it cannot, because every public
entry point (`getPortalOnboardingStatus`, `getPortalServices`,
`getPortalDocuments`) calls `requirePermission("portal.access",
input.organizationId)` FIRST, which independently re-derives real
membership for that exact id before the bridge is ever touched — the
same universal pattern (`requirePermission()`) every other service in
this codebase already uses, applied here to gate access to the bridge
itself.

## Customer-safe projection architecture

Every `PortalXService.getPortalX()` function is self-contained
(re-verifies its own authorization via `requirePermission("portal.access", ...)`
or the section's own existing permission — never trusts a caller's
claim) and returns a narrow, purpose-built type:

- **`portal-dashboard-service.ts`** — `getPortalDashboard()`. Resolves
  the customer's `CrmCompany` link ONCE and passes it into onboarding/
  services sub-reads (`precomputedCrmCompany` — the same pattern
  Build 25's own `precomputedCompany360` established) instead of each
  one re-resolving it independently.
- **`portal-company-service.ts`** — `getPortalCompany()`. Real
  `Organization` profile fields (already customer-owned — no internal
  CRM tags/lead source/sales notes/health metadata exist ON
  `Organization` at all, so there is nothing to accidentally leak
  here) + the active member roster (gated separately by `members.read`)
  + a bare `crmLinked: boolean` (never any further CRM detail).
- **`portal-onboarding-service.ts`** — `getPortalOnboardingStatus()`.
  Status + `progressPercent` (computed via Build 23's own pure
  `calculateProgress()`) + kickoff dates. Deliberately does NOT expose
  individual requirements/checklist items/intake fields/responses —
  see "Onboarding visibility" below.
- **`portal-services-service.ts`** — `getPortalServices()`. Onboarding
  service items if present, else the accepted proposal's own line
  items — the SAME precedence Customer 360's own `resolveServices()`
  established, re-implemented as its own Portal-safe function (never
  calling Customer 360 directly).
- **`portal-documents-service.ts`** — `getPortalDocuments()`. Accepted
  proposal (rendered `bodyHtml`, already sanitized server-side at
  write time — see `CrmProposalVersion.bodyHtml`'s own schema comment
  — safe to render via the existing `SanitizedHtmlView`), contracts,
  onboarding document references.
- **`portal-notifications-service.ts`** — `getPortalNotifications()`.
  See "Notifications" below.
- Billing/Invoices/Payments/AI/Profile call the EXISTING Module 13/17/
  04/07 service functions directly — no wrapper needed, since those
  functions were already built for exactly this self-service context.

## Dashboard

`getPortalDashboard()` composes: organization identity + CRM-link flag,
onboarding status (aggregate only), services count, billing account/
subscription/latest-invoice summary (gated on `billing.read`), the 5
most recent Portal-scoped notifications, and a `documentsAvailable`
flag. Never shows: churn risk, health score, sales pipeline, internal
forecasts, sales rep performance, internal CRM notes, account-management
flags — none of that data is even fetched, let alone rendered.

## My Company

`/portal/company` — real `Organization` profile fields, editable via a
thin action (`updatePortalCompanyProfileAction`) wrapping the EXISTING
`updateOrganizationProfile()` (Module 07) — no parallel company-profile
storage, no new write path. The active member roster (name/email/role/
status) is shown only when the caller holds `members.read` (owner/admin
by default); other roles see an honest "No access" state for that one
section, while the profile itself remains visible to everyone with
`portal.access`.

## My Services

Roadmap Module 23 (Service Management) doesn't exist. `/portal/services`
shows a labeled snapshot — "Purchased / onboarding services," never a
Service Catalog — sourced from `CrmClientOnboardingServiceItem` (once
onboarding has started) or the accepted proposal's own line items
(before that). Only customer-safe commercial fields (title/description/
quantity) — no internal discount mechanics, no staff notes.

## My Projects / Tasks / Reports / Tickets / Messages

None of Roadmap Modules 21 (Project Management), 22 (Task Management),
66 (Reporting Engine), 30 (Support Center), or 46 (Communication Center)
exist yet. Each of `/portal/projects`, `/portal/tasks`, `/portal/reports`,
`/portal/tickets`, `/portal/messages` renders the SAME shared
`PortalUnavailable` component — an honest "Not available yet" state
naming the exact Roadmap module that will replace it — never fabricated
counts, never onboarding checklist items relabeled as "projects" or
"tasks," never CRM activities relabeled as "tickets," never a chat UI
standing in for "messages." No `Ticket`/`Project` model, no global Task
Management, was created by this build (grep confirms no new schema
additions for any of these five concepts). `PortalUnavailable` itself
IS the extension seam — a future build replaces the page body it
returns, nothing about the route/nav/gate needs to change.

## Documents

No real file storage exists yet (Roadmap Module 56 — every
`StorageProvider` method throws `StorageNotConfiguredError`;
`CrmClientOnboardingDocument.fileKey` is always `null` — confirmed live
during this build's own reconnaissance, the same finding Build 22's own
PDF-generation section and Build 23's own onboarding-document model
already documented). `/portal/documents` is therefore a structured,
already-safe DATA projection, never a download link that goes nowhere:
the accepted proposal (rendered via `SanitizedHtmlView` + its real line
items/total), contracts (number/status/dates/renewal terms), and
onboarding document REFERENCES (title/status/receivedAt only — no
fake "Download" button, an inline note that file access isn't
available yet). No signed URLs are needed because there is nothing to
sign.

## Invoices

`/portal/billing/invoices` and `/portal/billing/invoices/[invoiceId]`
call the EXISTING `listInvoicesForOrganization()`/
`getInvoiceForOrganization()` (Module 13) directly — the SAME functions
`/organizations/[id]/billing/invoices` already uses, already
`billing.read`-gated, already IDOR-safe (`getInvoiceForOrganization()`
independently checks `invoice.organizationId !== organizationId` →
`NotFoundError`, re-verified for Portal's own call path in both the
integration security suite and E2E). No direct Stripe calls, no
internal reconciliation/debug metadata shown, no trusting `invoiceId`
from the URL beyond that one ownership check.

## Payments

`/portal/billing/payments` calls the EXISTING `listPaymentsForOrganization()`
(Module 13) directly — read-only. No customer-initiated payment action
is built here beyond the EXISTING Stripe-hosted "Manage payment method"
button (`createBillingPortalSession()`, `billing.manage`) — Alpha OS
never builds its own card-entry form or a second payment abstraction.
Shown fields: amount/currency/status/masked card brand+last4/paid date/
a provider-classified failure message on `FAILED` (already documented
as safe — spec §42, never a raw provider error body). Never shown:
`providerPaymentId`, `billingAccountId`, `invoiceId` raw internal
references.

## Notifications

`getPortalNotifications()` reuses the EXISTING `notifications` table's
own RLS (`recipient_user_id = tenant_current_user_id() OR platform` —
user-owned, not organization-owned) and repository, adding an
ADDITIONAL `organizationId` filter Portal's own view applies on top —
narrowing what a Portal caller sees to notifications actually
associated with THIS organization, so a person who happens to ALSO
hold a platform-staff membership (a real, if narrow, scenario) never
sees an internal/staff-assignment notification bleed into their Portal
view. This is an additional narrowing, never the sole boundary — the
real access boundary (`recipientUserId`) is unchanged and still
enforced identically to the generic `/notifications` page. Preferences
are unchanged — Portal's nav links straight to the EXISTING
`/settings/notifications` page. `NotificationItem`'s own mark-read/
unread/archive actions (Module 09) are reused as-is on
`/portal/notifications`; their `revalidatePath()` calls were extended
to also revalidate `/portal`/`/portal/notifications` so a mutation from
the Portal view doesn't leave the Portal's own cache stale.

## AI Assistant

The single most consequential decision in this build's own AI section:
**reuse the EXISTING, already-safe Module 17 organization-scoped
assistant (`/organizations/[id]/assistant`) as-is, rather than building
a new, CRM-grounded pipeline.** That assistant is already a real,
working, non-fake conversational AI — explicitly documented (its own
system prompt) as NOT grounded in the organization's own account/
billing/service data, meaning it structurally cannot leak internal CRM/
Customer 360/Client Success information: it has no retrieval step at
all, only a fixed system prompt. `/portal/assistant` and
`/portal/assistant/[conversationId]` call the SAME
`ai-conversation-service.ts` functions (`startConversation`,
`sendMessage`, `getConversation`, `listConversations`,
`closeConversation`) through a thin, Portal-local `actions.ts` (the
only duplication is the presentational client components/action
wrappers — a deliberate, small, justified cost, not duplicated
business logic), gated by the EXISTING `ai.use`/`ai.manage`.

**What this build deliberately does NOT build**: a customer-specific,
CRM-grounded RAG assistant. The master authorization's own required
pipeline (authenticated customer → membership → authorization →
portal-safe KNOWLEDGE ACCESS POLICY → tenant context → retrieval →
filtering → provenance → AI provider) has no existing, reviewed
"portal-safe knowledge access policy" to build on yet — Module 18's own
knowledge/retrieval infrastructure is currently scoped to ordinary
organization self-service (an org's own ingested support docs), not to
a policy that would let a customer safely retrieve grounded facts about
THEIR OWN Alpha-Page-Rankers account (onboarding/contract/billing)
without a real risk of the retrieval boundary leaking adjacent
customers' or internal data if built hastily. Rather than fake this
boundary, this build ships the real, already-safe, ungrounded
assistant and documents the gap explicitly: a future, dedicated
customer-context retrieval policy (likely layered on Roadmap Module 34
— AI Agent Platform, or a dedicated Portal-safe knowledge-scoping
extension to Module 18) is the honest path to a grounded assistant,
not a shortcut taken here.

## Profile

`/portal/profile` reuses the EXISTING `/profile` page's own
`ProfileForm`/`user-profile-service.ts` AS-IS — genuinely zero new
backend code, since that surface was ALREADY user-scoped and safe (no
`role`/`membershipId`/`organizationId`/password hash ever exposed
there, by that module's own original design). Security/sessions link
straight to the EXISTING `/settings/account`/`/settings/sessions`. No
`CustomerProfile` table, no parallel profile-write path, and no path
by which a Portal page can edit role/permission/membership fields —
`updateOwnProfile()` (the underlying service) has no such fields to
edit in the first place.

## Contract/proposal visibility

Only the ACCEPTED proposal (most recent, if more than one exists) and
real `CrmContract` rows are surfaced, projected through
`portal-documents-service.ts`'s own narrow types — never the internal
approval workflow (`approvalStatus`/`approvalSubmittedByUserId`/
`approvalNote`), rejection notes, drafts, superseded versions, unsent
versions, or staff-only lifecycle controls (send/revise/approve
buttons). `terminatedReason` on a contract is deliberately NOT shown —
treated as potentially staff-authored/sensitive, per the master
authorization's own conservative instruction, even though a customer
might reasonably want to know why their own contract ended; a future
build can revisit this with an explicit customer-facing reason field
if genuinely needed.

## Onboarding visibility

Status + `progressPercent` (never a raw requirement/checklist/intake
list) + kickoff dates. **Deliberately does not expose**: individual
`CrmClientOnboardingRequirement`/`ChecklistItem`/`IntakeField`/
`IntakeResponse` records — none of them carry a `customerVisible` flag
anywhere in the Build 23 schema, and serializing internal, staff-
authored records (assignee names, staff-facing due dates, internal
readiness flags, `completionOverrideReason`) would cross the internal/
customer boundary this whole build exists to enforce. This is a real,
documented limitation, not an oversight — a future build could add an
explicit per-item `customerVisible` boolean if finer-grained visibility
is ever genuinely wanted; this build does not fabricate that
granularity without real schema support.

## Persistence

**None.** Zero new Prisma models, zero new migrations — this build
reuses `Organization`/`OrganizationMembership`/`CrmCompany`/
`CrmClientOnboarding`/`CrmProposal`/`CrmContract`/`BillingAccount`/
`Invoice`/`Payment`/`Notification`/`User`/`AiConversation` exactly as
they already exist. The one repository-level (not schema-level)
addition is a new `linkedOrganizationId` filter on
`crmClientOnboardingRepository.listForOrganization()` — a read-path
extension, not persistence, reusing the ALREADY-EXISTING
`@@index([organizationId, linkedOrganizationId])` index Build 23 itself
established. No Codex DB Engineer was dispatched — there was nothing in
scope for that specialist (per the master authorization's own explicit
"if no DB change is required: skip Codex DB Engineer" instruction).

### Contact ↔ User linkage — a deliberate non-decision

`CrmContact` and `User` remain fully separate identities, with **no
linkage introduced by this build**. Every Portal function this build
needed resolves via `Organization`/`OrganizationMembership`/
`CrmCompany.convertedToOrganizationId` — none of Company/Services/
Documents/Billing/Onboarding status genuinely requires knowing "which
CrmContact corresponds to this logged-in User." Introducing a linkage
table or column with no real consuming feature would be exactly the
"add persistence pre-emptively" the master authorization explicitly
warns against. If a future build genuinely needs this (e.g. "My
Company" showing "you are the primary contact for X"), the same
disciplined shape the master authorization describes applies then:
tenant-validated, unique where required, auditable, no cross-tenant
linking, explicit — never inferred silently from a matching email.

## Row-level security / tenant isolation

No new tables ⇒ no new RLS policies to author. What this build proves
instead:

- **Billing/notification tables** (`organization_id =
  tenant_current_organization_id() OR tenant_is_platform_context()`) —
  a customer's own tenant context already satisfies this directly;
  Portal's calls to `getBillingAccount`/`listInvoicesForOrganization`/
  `getPortalNotifications`/etc. work correctly under the caller's own,
  ordinary (non-elevated) tenant context, exactly as
  `/organizations/[id]/billing` already proves.
- **CRM tables** (`organization_id = tenant_current_organization_id()
  AND tenant_is_platform_context()`) — structurally unreachable under a
  customer's own tenant context; only the narrowly-scoped, verification-
  gated `portal-crm-bridge.ts` (see above) can reach them, and only
  after independently re-deriving real membership for the exact
  organization id being read.
- `tests/integration/db/portal-security.test.ts` proves: every
  non-eligible membership/organization state is denied by
  `resolvePortalContext()` (no membership, INVITED, SUSPENDED
  membership, SUSPENDED organization, ARCHIVED organization,
  platform-org-only membership); the CRM bridge never attaches
  organization A's converted company/onboarding/proposal to
  organization B's own view even when both exist side by side and are
  read through the SAME bridge function; a caller with no membership in
  the target organization is rejected by `requirePermission()` before
  the bridge is ever reached; an organization with no CRM conversion at
  all returns honest empty states, never an error and never another
  organization's data; `getPortalNotifications()`'s organization filter
  correctly isolates a genuinely multi-org user's own two organizations'
  notifications from each other; cross-organization invoice access
  remains denied when reached through Portal's own service import path.

## Security

Codex Security Engineer (read-only, adversarial, HIGH PRIORITY per the
master authorization) — full attack-category list at
`.codex-tasks/portal-security-review.txt` (auth, tenancy/IDOR, company,
documents, billing, notifications, profile, AI, and an explicit
internal-data-boundary grep sweep). Headline conclusion: **the CRM
bridge's present production call chains correctly re-verify live
session, membership, organization state, and `portal.access`; no
organization A → organization B CRM disclosure path was found.**
Concrete findings, all fixed:

- **Medium — `/portal/documents` showed contracts in every status,
  including internal `DRAFT`** (never-sent negotiation state — no
  customer commitment exists yet). Fixed: `getPortalDocuments()` now
  filters `status !== "DRAFT"`; every other real, settled status
  (ACTIVE/EXPIRED/TERMINATED/CANCELLED) stays visible.
- **Medium — the full `AiMessage` row (model, token counts, estimated
  cost, latency, the provider's own message id) reached the browser's
  page payload**, not just what `ChatMessage` visually rendered — a
  server→client prop, not a rendering choice, so trimming the render
  call alone wouldn't have fixed it. Fixed: a narrow `PortalChatMessage`
  projection (`id`/`role`/`content`/`createdAt`) is built at the
  SERVER boundary (`portal/assistant/actions.ts` and the conversation
  detail page) before anything crosses into a client component.
- **Medium — Portal onboarding exposed a raw `createdAt` timestamp
  beyond the documented `status`/`progressPercent`/kickoff-dates
  aggregate**, unused by any page. Fixed: dropped from
  `PortalOnboardingStatus`.
- **Low — every mutating Portal Server Action enforced its own
  capability permission (`organizations.update`, `billing.manage`)
  but not the `portal.access` floor** — a hypothetical future custom
  organization role holding one of those without `portal.access` could
  still mutate through a Portal-specific action. Fixed: `portal.access`
  is now independently re-verified in `updatePortalCompanyProfileAction`,
  `openPortalBillingPortalAction`, and all three AI assistant actions.
- **Low, reviewed and declined — `/portal/profile` is the only Portal
  page that doesn't call `guardPortalPage()`.** Deliberate, not an
  oversight: this page's content is identical to the already-
  unrestricted `/profile` (self-owned, no organization dependency at
  all), and gating it more strictly than `/profile` itself would block
  a real authenticated user from editing their own name/timezone
  merely for lacking Portal eligibility — a usability regression, not
  a security improvement, since nothing organization-scoped is ever
  shown there.
- **Low hardening note, not fixed — the CRM bridge's own exported
  primitives (`withPortalCrmReadContext`/`portalPlatformOrganizationId`)
  and the unbound `precomputedCrmCompany`/`precomputedOnboarding`
  parameters make future misuse possible if a caller ever passed an
  unverified id, though no exploitable call chain exists today.**
  Accepted as a documented risk surface (see this file's own top
  comment, which states the trust contract explicitly) rather than
  restructured — every CURRENT caller is internal to
  `src/server/services/portal/**` and already verified.
- **Full `Notification` rows crossing into the client `NotificationItem`
  component (metadata, source-entity ids, event names, idempotency
  key) — noted, not fixed in this build.** `NotificationItem` is a
  SHARED, pre-existing, mutate-capable component already used
  identically by `/notifications` for every persona (admin, support,
  customer) since Module 09 — this is an inherited pattern Build 26
  reuses, not one it introduces. A proper fix means either a Portal-
  specific projection type plus a parallel mutate-capable component
  (real duplication of working, already-audited mutation logic) or
  changing the shared component's own prop contract (a cross-cutting
  change reaching far outside Portal). Documented here as accepted,
  prioritized future work rather than attempted under this build's own
  already-large scope.

## IDOR

Every id a Portal page accepts from a route param or form field
(`invoiceId`, `conversationId`, `organizationId` in the org-switch
form) is re-verified against the caller's own real, current
authorization before any data is returned — never trusted as proof of
access on its own. Proven directly: a captured invoice id belonging to
a different organization (found via a live SQL lookup, not fabricated)
is denied with the same honest "could not be found" page a genuinely
nonexistent id would produce (`tests/e2e/portal.spec.ts`); the
CRM-bridge cross-tenant isolation above; `getInvoiceForOrganization()`'s
own pre-existing ownership check re-verified through Portal's own code
path (`tests/integration/db/portal-security.test.ts`).

## Session lifecycle

Unchanged from Module 04 — Portal uses `requireAuthenticatedPage()`/
`getCurrentUser()` exactly as every other protected page does: a
revoked `UserSession` or expired JWT is denied on the very next
request, before any Portal-specific logic runs. No new session
mechanism, no new cookie beyond the organization-selection one Module
06 already established.

## Audit

No new audit actions or `PortalAudit` table. Portal introduces exactly
one new class of mutation — organization profile edits via "My
Company" — which already flows through the EXISTING, already-audited
`updateOrganizationProfile()` (`organization.updated`). Notification
preference changes remain on the existing `/settings/notifications`
page/service, already audited there. Ordinary Portal page views are
never audited (matching every other read-heavy surface in this
codebase).

## UI

`/portal` and its sub-routes live in `src/app/(protected)/portal/**` —
never under `/admin/**`, never reusing an internal CRM page directly.
The EXISTING shared `(protected)/layout.tsx`/`AppShell` renders Portal's
own navigation as a new "Portal" `NavGroup`, shown only when the caller
has at least one eligible organization (`resolvePortalContext()`,
resolved once per page load — the same cost every OTHER persona's own
nav-gating already pays via `resolvePlatformContext()`) — no separate,
duplicated shell was built. `resolveDestination()`'s own
`DESTINATIONS.customer` now points at `/portal` (previously the literal
Module 04 placeholder `/dashboard`, which now simply redirects there);
`owner`/`admin` keep their EXISTING `/organizations/${id}` post-login
destination unchanged (a deliberate, lower-risk choice — see "Known
limitations"), reachable from Portal's own nav via the unchanged
"Organizations" link.

## Performance

Codex Performance Engineer (read-only, static call-graph review) —
full report at `.codex-tasks/portal-performance-findings.md`. Headline
conclusions confirmed clean: **no Portal page loops over a result set
and calls an expensive internal composition per item** (`getCustomer360()`/
`getClientSuccessHealth()` are referenced nowhere in the Portal tree);
`precomputedCrmCompany` genuinely eliminates the redundant `CrmCompany`
reads it was built to eliminate; every user-facing list already carries
a real cap (notifications/invoices/payments cursor-capped at 25,
conversations 20/max 50, members capped at 100, CRM proposal/contract/
onboarding root lists capped at 200); the `linkedOrganizationId` filter
correctly hits the existing `@@index([organizationId, linkedOrganizationId])`.

Findings fixed:

- **The Dashboard resolved the CrmCompany link, then separately let
  `getPortalOnboardingStatus()`/`getPortalServices()` EACH independently
  re-run the same bounded current-onboarding lookup.** Fixed: a new
  `resolvePortalCrmSnapshot()` resolves the company AND its current
  onboarding together, in one elevated transaction; both are passed
  down as `precomputedCrmCompany`/`precomputedOnboarding`, eliminating
  the duplicate read entirely.
- **The CRM bridge resolved the platform organization id twice per
  call** (once to open its own transaction, again inside the read
  closure). Fixed: resolved once, reused.
- **`getPortalOnboardingStatus`/`getPortalServices`/`getPortalDocuments`
  opened a full elevated transaction even when the caller already knew
  there was no CRM link** (`precomputedCrmCompany === null`), only to
  return immediately from inside it. Fixed: short-circuit before
  `withPortalCrmReadContext()` is ever called.
- **The Dashboard's own CRM-link resolution serialized in front of
  independent reads** (organization/billing/notifications don't depend
  on it at all). Fixed: `resolvePortalCrmSnapshot()` now runs inside
  the SAME `Promise.all` as those other reads, not before it.
- **`getPortalCompany()` awaited organization → members → CRM-link
  sequentially** despite all three being independent once permissions
  are resolved. Fixed: `Promise.all`.
- **`getPortalDocuments()`'s proposal-version/line-item chain and its
  onboarding-document read were serialized** despite depending on
  different, already-resolved inputs. Fixed: `Promise.all`.

Findings reviewed and accepted as documented, out-of-scope limitations
(not fixed in this build):

- **Credit ledger loaded in full to render only `balance`/`currency`
  on the Billing page.** This is `getCreditBalance()`'s own Build 14
  behavior, reused as-is — Customer 360 (Build 24) already documented
  the SAME underlying pattern (`getOrganizationBillingForPlatform()`'s
  own credit-balance calculation) as an inherited, accepted limitation
  rather than something a later, unrelated build should silently patch
  by rewriting a Module 13 service. A real fix (a database `SUM`
  aggregate) belongs to Module 13's own scope.
- **AI conversation detail loads the complete message history with no
  cursor/cap.** `ai-conversation-service.ts`'s own Module 17 behavior,
  reused as-is — typical conversation lengths are naturally small
  (unlike a customer's billing history, which grows for the account's
  entire lifetime), and adding pagination is Module 17's own scope to
  own, not a side effect of this build reusing its existing assistant.
- **The layout → guard → dashboard path calls `resolvePortalContext()`
  up to three times per request** (once for nav visibility in the
  shared layout, again in each page's own `guardPortalPage()`, a third
  time on `/portal` itself for the organization-picker list), and every
  organization-scoped `requirePermission()` call independently re-runs
  `resolveOrganizationContext()`'s own ~8-SELECT composition. This is a
  real, measurable cost, and the architecturally complete fix (request-
  scoped memoization via React `cache()`, or threading one verified
  context through every internal call) is the right long-term
  direction — but applying it means changing `getCurrentUser()`/
  `resolveOrganizationContext()`/`resolvePlatformContext()`, foundational
  functions EVERY protected page and service across all 25 prior builds
  already calls, a blast radius far beyond this build's own scope and
  explicitly out of bounds per the master authorization ("do NOT
  re-audit Builds 19–25 unless Build 26 exposes a direct dependency
  problem" — a pre-existing architectural trade-off, not a Build-26-
  introduced defect, is not that). This matches the SAME "repeated
  authorization resolution is a known, accepted, proportionate
  trade-off" precedent Customer 360 (Build 24) and Client Success
  (Build 25) already established for their own granular per-service
  authorization calls. Recorded here as the highest-priority item for a
  FUTURE, dedicated cross-cutting performance build, not deferred
  silently.
- **Several child-list reads return full internal rows/no cap where
  Portal renders only a small projection** (onboarding checklist items
  loaded in full to compute a required/status aggregate, proposal line
  items, onboarding document references, invoice line items,
  subscription items). None of these scale with the number of Portal
  CUSTOMERS or grow unboundedly the way a billing/message history does
  — each is bounded by one customer's own, naturally small operational
  history. Narrowing these to `select`-projected reads is legitimate
  future cleanup, not a correctness or scaling risk today.
- **Full `Notification` rows cross the Server Component → client
  boundary** — see "Security" above (the same finding, same reasoning
  for why it's deferred: a shared, pre-existing, already-audited
  component).

## Codex specialist work

- **Security Engineer** (read-only, adversarial, HIGH PRIORITY per the
  master authorization): dispatched against the full attack-category
  list in `.codex-tasks/portal-security-review.txt`.
- **Performance Engineer** (read-only): dispatched against
  `.codex-tasks/portal-performance-review.txt` — dashboard query count,
  N+1, the CRM bridge's own redundant-resolution risk, index coverage
  for the new `linkedOrganizationId` filter.
- No DB Engineer was dispatched — no new persistence needed (see
  "Persistence").
- E2E and accessibility were written directly by Claude, not delegated
  — Codex's own sandbox cannot launch Chromium, the same constraint
  every prior build in this series has documented.

## Testing

- **Integration/security**
  (`tests/integration/db/portal-security.test.ts`): eligibility-denial
  matrix, CRM-bridge cross-tenant isolation, unauthorized-organization
  rejection, honest empty states for a never-converted organization,
  multi-org notification isolation, cross-organization invoice IDOR
  re-verification.
- **E2E** (`tests/e2e/portal.spec.ts`): access control (unauthenticated,
  zero-membership platform staff, pre-RBAC role with no `portal.access`,
  ordinary-member destination routing), dashboard/company/services/
  documents with a real seeded engagement (uniquely identified, never
  relying on list position), My Company profile edit persistence,
  billing/invoices/payments with real Acme Corp history plus a live
  cross-organization invoice IDOR probe, notifications, the AI
  assistant's own safe-unconfigured-provider behavior (matching
  `ai-assistant.spec.ts`'s own established pattern — this dev
  environment has no `ANTHROPIC_API_KEY` configured), profile, every
  unavailable-module state, multi-organization behavior, responsive
  behavior. **Session reuse**: one shared `owner-a@alpha-os.test`
  login for the whole file (an earlier draft made exactly the mistake
  Build 25's own findings warned against — 13 separate per-test logins
  — caught by the real `authRateLimiter` failing the run, then
  rewritten to this shared-session shape).
- **Accessibility** (`tests/e2e/portal-accessibility.spec.ts`): every
  core Portal page, both themes, desktop/tablet/mobile, an `owner`
  (full-access) and a `viewer` (read-only) role, the My-Company edit
  form, invoice list/detail, a bare organization with zero CRM
  engagement (every empty state at once) — zero axe violations
  required. Two shared logins for the whole file, matching the same
  rate-limiter discipline.
- **Test-data discipline** (a required regression improvement from
  Build 25's own findings): every E2E/accessibility fixture is
  self-identifying (a `Date.now()` suffix on every unique field) and
  every assertion matches that exact substring or navigates via a
  directly-captured id — never "the Nth row" or "within the first page
  of some list." `seedPortalEngagement()`'s own company-creation step
  is idempotent (find-or-create against the UNIQUE
  `converted_to_organization_id` constraint) specifically because a
  shared dev database accumulates fixtures across repeated runs — a
  real collision this build's own first E2E run caught live, not
  found by inspection.

## Real bugs found

- **A genuine IDOR false-positive in the security test's own mock, not
  the application** — `tests/integration/db/portal-security.test.ts`'s
  first draft used a `getCurrentMembership()` mock keyed only by
  organization id; with two different customer users' memberships live
  in the same map (needed to prove real cross-user isolation), the mock
  returned USER B's membership while `mockUser` was USER A, producing a
  false "IDOR" where the real `getPortalOnboardingStatus()` correctly
  denied access. Diagnosed by inspecting the actual
  `resolveOrganizationContext()`/`getCurrentMembership()` real-vs-mocked
  code paths, fixed by re-keying the mock `${organizationId}:${userId}`
  and filtering by the current mock user — the SAME class of "test mock
  doesn't replicate the real per-user scoping" bug, not a product
  defect.
- **`crm_companies.converted_to_organization_id`'s own UNIQUE
  constraint** collided on a second E2E run against the same seeded
  organization — fixed with an idempotent find-or-create in the seed
  helper (see "Testing" above).
- **A test-only assumption bug**: asserting `getByText("Acme Corp")` on
  the My-Company page's OWN editable form — "Acme Corp" only appears
  there as an `<input>`'s `value`, never as a text node, so
  `getByText()` correctly finds nothing for the `canEdit: true` (owner)
  case. Fixed to assert `toHaveValue()` instead — not a rendering bug,
  a wrong test expectation.
- **The AI assistant test's own wrong expectation**: this dev
  environment has no `ANTHROPIC_API_KEY` configured (confirmed absent
  from `.env`/`.env.local`) — the SAME pre-existing, already-documented
  limitation `ai-assistant.spec.ts` (Module 17) already establishes a
  test pattern for. An initial draft of this build's own Portal
  assistant test expected a real successful reply and navigation; fixed
  to match the SAME established "surfaces a safe error, the user's own
  message is still persisted" pattern.
- **My own first E2E draft logged in 13 separate times as
  `owner-a@alpha-os.test`** (one per test) instead of sharing one
  session — caught when the real `authRateLimiter` (10 requests/15min
  per email) started failing later tests' own logins mid-run; rewritten
  to the shared-session-per-file shape described in "Testing" above,
  matching the master authorization's own explicit "Test Data
  Discipline" requirement.

## Data-honesty guarantees

Never fabricated: projects, tasks, tickets, messages, reports, AI
responses, service performance, project statuses, support stats,
churn risk, health score, sales forecasts. Every unavailable-module
page names its real, exact Roadmap Module number rather than a vague
"coming soon." A company with no CRM conversion shows honest empty
states across Company/Services/Documents/Onboarding — never an error,
never invented data.

## Quality gates

`npm run lint`, `npm run typecheck`, `npm test`, `npx prisma validate`,
`npx prisma generate`, `npx prisma migrate status`, `npm run build` —
all run at the end of this build (see the completion report for
results). No schema changed, so `prisma generate`/`migrate status` have
nothing new to reconcile.

## Known limitations

- `owner`/`admin` still land on `/organizations/${id}` after login
  (unchanged from before this build) rather than `/portal` — a
  deliberate, lower-risk choice: that destination is already a fuller,
  already-tested management surface for exactly those two roles, and
  changing it would have touched existing, already-passing regression
  tests for no functional gain (Portal remains fully reachable for
  owner/admin via the shared nav's own "Portal" group, and via direct
  navigation). A future build could reconsider unifying this if Portal
  ever becomes the intended primary landing surface for every role.
- No customer-specific, CRM-grounded AI assistant — see "AI Assistant"
  above for the explicit boundary and what a real one would require.
- Onboarding requirements/checklist items/intake responses stay
  aggregate-only (status/progress) — no per-item customer visibility
  flag exists in the schema yet.
- No real file storage — Documents stays metadata-only until Roadmap
  Module 56 exists.
- The pre-RBAC `support@alpha-os.test`-style accounts (a real
  organization membership with a `null roleId`, predating Module 05)
  correctly land on the Portal's own "denied" gate rather than
  "no organization" — expected, not a bug, but worth knowing this
  class of legacy account exists in the dev seed data.

## Future Roadmap Module 21–23/30/45/46/66 compatibility

Every unavailable page (`PortalUnavailable`) is the extension seam
itself — a future build replaces that one page's body with a real
composition once its owning module exists, without touching the Portal
nav, the shared gate, or any other page. Roadmap Module 23 (Service
Management) can replace/augment `portal-services-service.ts`'s own
commercial-snapshot heuristic with a canonical service record once one
exists. Roadmap Module 45 (Document Management) can upgrade
`portal-documents-service.ts`'s metadata-only projection into a real,
signed-download-capable one once Module 56's storage abstraction (and
Module 45's own document model) exist — the projection SHAPE
(`PortalProposalDocument`/`PortalContractDocument`/
`PortalOnboardingDocumentReference`) is already the right seam to
extend, not replace.
