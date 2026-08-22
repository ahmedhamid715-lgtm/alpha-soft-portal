import type { SubscriptionStatus } from "@/generated/prisma/client";
import { SubscriptionChangeRejectedError } from "./errors";

/**
 * The explicit subscription lifecycle (Module 14 spec §3/§40) — Alpha
 * OS's own domain state machine, not a blind copy of Stripe's own
 * enum (schema.prisma's own `SubscriptionStatus` doc comment already
 * makes this call; this file is where the ALLOWED TRANSITIONS between
 * those states are actually enforced, which Module 13 left implicit).
 *
 * Two axes of state, modeled deliberately as SEPARATE fields rather
 * than folded into one enum (this is Alpha OS's own design choice, not
 * Stripe's):
 *
 *   - `SubscriptionStatus` — the provider-reconciled lifecycle stage.
 *   - `cancelAtPeriodEnd` — an orthogonal flag: an ACTIVE subscription
 *     can be "active, will renew" or "active, will cancel at period
 *     end" without that being a different STATUS at all (Stripe itself
 *     models it exactly this way — `status: "active"` +
 *     `cancel_at_period_end: true`). Modeling "CANCEL_AT_PERIOD_END" as
 *     a distinct status (as the spec's own illustrative diagram
 *     suggests) would require inventing a NINTH status Stripe never
 *     reports and reconciling it by hand on every webhook — this
 *     module instead treats "cancel scheduled" as the flag it actually
 *     is. `describeLifecycleState()` below is what renders the
 *     combined, human-meaningful state the spec's diagram is really
 *     asking for.
 *
 * Every function here is PURE — no database access, no provider call.
 * `validateSubscriptionTransition()` is called at the START of every
 * subscription-mutating service function, before any side effect, so a
 * rejected transition never reaches Stripe or the database at all.
 */

export type LifecycleState =
  | "TRIALING"
  | "ACTIVE"
  | "ACTIVE_CANCEL_AT_PERIOD_END"
  | "PAST_DUE"
  | "PAUSED"
  | "CANCELED"
  | "INCOMPLETE"
  | "INCOMPLETE_EXPIRED"
  | "UNPAID";

/** The combined, human-meaningful lifecycle state — folds `cancelAtPeriodEnd` into `ACTIVE` (see this file's own top comment for why that's not a 9th `SubscriptionStatus` enum value). */
export function describeLifecycleState(status: SubscriptionStatus, cancelAtPeriodEnd: boolean): LifecycleState {
  if (status === "ACTIVE" && cancelAtPeriodEnd) return "ACTIVE_CANCEL_AT_PERIOD_END";
  return status;
}

export type SubscriptionAction =
  | "START_TRIAL"
  | "ACTIVATE"
  | "CHANGE_PLAN"
  | "SCHEDULE_CANCELLATION"
  | "UNDO_SCHEDULED_CANCELLATION"
  | "CANCEL_IMMEDIATELY"
  | "MARK_PAST_DUE"
  | "MARK_UNPAID"
  | "MARK_INCOMPLETE_EXPIRED";

/**
 * The allowed-transitions table (spec §3's own example, generalized to
 * every state this domain actually has). Each entry lists which
 * ACTIONS are valid to attempt FROM that state — read by
 * `validateSubscriptionTransition()` below. `cancelAtPeriodEnd` is
 * threaded through separately since it isn't a `SubscriptionStatus` of
 * its own (see top comment).
 *
 * Deliberately NOT included anywhere: `CANCELED → ACTIVE` (spec's own
 * explicit prohibition — "unless the business/provider workflow
 * explicitly supports reactivation as a new subscription"). Alpha OS's
 * supported path for a fully-canceled organization IS exactly that: a
 * brand new `Subscription` row via `startCheckoutForPlanPrice()` — a
 * new subscription, never a resurrected old row. See
 * `subscription-lifecycle.md` "Why CANCELED is terminal."
 */
const ALLOWED_ACTIONS_FROM_STATUS: Record<SubscriptionStatus, ReadonlySet<SubscriptionAction>> = {
  TRIALING: new Set(["ACTIVATE", "CHANGE_PLAN", "SCHEDULE_CANCELLATION", "CANCEL_IMMEDIATELY", "MARK_PAST_DUE"]),
  ACTIVE: new Set(["CHANGE_PLAN", "SCHEDULE_CANCELLATION", "UNDO_SCHEDULED_CANCELLATION", "CANCEL_IMMEDIATELY", "MARK_PAST_DUE"]),
  PAST_DUE: new Set(["CHANGE_PLAN", "CANCEL_IMMEDIATELY", "MARK_UNPAID", "ACTIVATE"]),
  PAUSED: new Set(["ACTIVATE", "CANCEL_IMMEDIATELY"]),
  UNPAID: new Set(["CANCEL_IMMEDIATELY", "ACTIVATE"]),
  INCOMPLETE: new Set(["ACTIVATE", "MARK_INCOMPLETE_EXPIRED", "CANCEL_IMMEDIATELY"]),
  INCOMPLETE_EXPIRED: new Set([]), // terminal — the checkout attempt that produced this row simply never completed; start a new one
  CANCELED: new Set([]), // terminal — see top comment
};

/**
 * The single chokepoint every subscription-mutating service function
 * calls FIRST (spec §3/§4: "every transition must be validated...
 * build explicit lifecycle transition rules"). Throws
 * `SubscriptionChangeRejectedError` (never a raw assertion) for an
 * invalid transition, WITHOUT having touched the provider or the
 * database yet.
 */
export function validateSubscriptionTransition(
  currentStatus: SubscriptionStatus,
  currentCancelAtPeriodEnd: boolean,
  action: SubscriptionAction,
): void {
  const allowed = ALLOWED_ACTIONS_FROM_STATUS[currentStatus];
  if (!allowed.has(action)) {
    throw new SubscriptionChangeRejectedError(
      `Cannot perform "${action}" on a subscription in state "${currentStatus}".`,
    );
  }
  // The two "cancellation flag" actions have their own, orthogonal
  // precondition beyond the status table above.
  if (action === "SCHEDULE_CANCELLATION" && currentCancelAtPeriodEnd) {
    throw new SubscriptionChangeRejectedError("This subscription is already scheduled to cancel at period end.");
  }
  if (action === "UNDO_SCHEDULED_CANCELLATION" && !currentCancelAtPeriodEnd) {
    throw new SubscriptionChangeRejectedError("This subscription is not scheduled for cancellation.");
  }
}

/** Whether `action` would currently be valid — used by the UI to decide which controls to render, never as the real authorization boundary (that's always `validateSubscriptionTransition()`, called server-side, on every mutation). */
export function canPerformAction(currentStatus: SubscriptionStatus, currentCancelAtPeriodEnd: boolean, action: SubscriptionAction): boolean {
  try {
    validateSubscriptionTransition(currentStatus, currentCancelAtPeriodEnd, action);
    return true;
  } catch {
    return false;
  }
}
