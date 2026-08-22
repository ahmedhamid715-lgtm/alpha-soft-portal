import { ConflictError, ExternalServiceError, NotFoundError, ValidationError } from "@/lib/errors/app-error";

/**
 * Billing-specific errors (spec §42) — thin subclasses of Module 01's
 * existing error architecture (`lib/errors/app-error.ts`), the same
 * pattern `lib/authorization/errors.ts` already established (not a
 * second error system). Every one of these carries a SAFE, generic
 * message — never a Stripe error string, stack trace, or provider
 * payload (see billing-security.md "Error mapping").
 *
 * `ExternalServiceError("Stripe")` (Module 01's existing 502 class) IS
 * this module's `ProviderUnavailable` — reused as-is, not duplicated;
 * see `provider/stripe/provider.ts` for where Stripe SDK errors are
 * caught and translated into it.
 */

/** The organization has no `BillingAccount`, or its account isn't in a state that permits the requested action (e.g. CLOSED). */
export class BillingAccountInvalidError extends ConflictError {
  constructor(message = "This organization's billing account cannot perform this action right now.") {
    super(message);
  }
}

/** A subscription/plan change was rejected — invalid target state, inactive price, or a provider-side rule (e.g. no payment method on file). */
export class SubscriptionChangeRejectedError extends ConflictError {
  constructor(message = "This subscription change could not be completed.") {
    super(message);
  }
}

/** The organization has no payment method on file and the requested action requires one. */
export class PaymentMethodRequiredError extends ValidationError {
  constructor(message = "A payment method is required before this action can be completed.") {
    super(message);
  }
}

export class InvoiceNotFoundError extends NotFoundError {
  constructor() {
    super("Invoice");
  }
}

export class PlanNotFoundError extends NotFoundError {
  constructor() {
    super("Plan");
  }
}

export class PlanPriceNotFoundError extends NotFoundError {
  constructor() {
    super("Plan price");
  }
}

export { ExternalServiceError };
