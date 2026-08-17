import "server-only";
import { serverEnv } from "@/config/environment";
import { logger } from "@/lib/logging";

/**
 * Server-only email abstraction. Module 04 established the first, minimal
 * version of this file (`MailProvider`/`mailer`, a single `send()` with no
 * result shape) purely to unblock verification/password-reset/invitation
 * emails before any real provider existed. Module 09 extends it IN PLACE
 * into the richer contract a real provider integration and delivery
 * tracking actually need — this is the SAME file, not a second
 * abstraction; every existing call site
 * (`sendVerificationEmail`/`sendPasswordResetEmail`/`sendInvitationEmail`)
 * keeps its exact signature and keeps working unchanged.
 *
 * See `docs/architecture/notification-delivery.md` for how
 * `lib/notifications/delivery.ts` uses `emailProvider` below.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain text — no HTML templating exists yet; add it to a real provider implementation, not here. */
  text: string;
}

/** A provider's own successful-acceptance response — "accepted for delivery," never a claim the message was actually received by its destination. */
export interface EmailSendResult {
  accepted: boolean;
  /** The provider's own message id, once accepted — for correlating with the provider's own dashboard/webhooks later. */
  providerMessageId?: string;
  metadata?: Record<string, unknown>;
}

/** Thrown by `EmailProvider.send()` on failure — never the provider's raw error object (see `docs/architecture/notification-security.md` "Provider error leakage"). */
export interface EmailSendError {
  /** Machine-readable (e.g. `"invalid_recipient"`, `"provider_timeout"`, `"provider_not_configured"`) — drives retryable/terminal classification in `lib/notifications/delivery.ts`. */
  code: string;
  /** Human-readable, already sanitized — safe to store, log, and (for a platform-staff observability view only) display. */
  message: string;
  /** Whether a later retry might succeed (a timeout) vs. never will (an invalid address). */
  retryable: boolean;
  metadata?: Record<string, unknown>;
}

export class EmailDeliveryError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly providerMetadata?: Record<string, unknown>;

  constructor(detail: EmailSendError) {
    super(detail.message);
    this.name = "EmailDeliveryError";
    this.code = detail.code;
    this.retryable = detail.retryable;
    this.providerMetadata = detail.metadata;
  }
}

export interface EmailProvider {
  /** Short, stable identifier — stored as `NotificationDelivery.provider` (e.g. `"console"`, later `"resend"`). */
  getName(): string;
  /** Cheap, synchronous sanity check (e.g. "is an API key present") — NOT a live connectivity test. Used by the provider-management admin surface (`notifications.manageProvider`) to show configuration health without sending anything. */
  validateConfiguration(): { valid: boolean; reason?: string };
  /** Resolves with `EmailSendResult` on acceptance; throws `EmailDeliveryError` on failure. Never resolves successfully merely because the function was called — see `notification-delivery.md` "A delivery is not SENT because the application called a provider." */
  send(message: EmailMessage): Promise<EmailSendResult>;
}

/**
 * Development-only provider — logs the message (never a raw token — see
 * below) and, in non-production environments, echoes the message body to
 * the console so a real inbox isn't needed to test the app locally. NOT a
 * silent success stand-in for a broken provider: it genuinely is the
 * configured provider until a real one is wired up, and both its log line
 * and `getName()` say so explicitly (spec's own requirement: "DO NOT fake
 * production delivery... clearly identify itself as non-production").
 *
 * Test hook: a recipient address containing `+delivery-fail` (e.g.
 * `user+delivery-fail@example.com`) makes `send()` throw a deterministic,
 * retryable `EmailDeliveryError` — the only way this module's own retry-
 * path tests can exercise a real failure without a real provider. Never
 * matches a normal address; documented here, not hidden.
 */
class ConsoleEmailProvider implements EmailProvider {
  getName(): string {
    return "console";
  }

  validateConfiguration(): { valid: boolean; reason?: string } {
    return { valid: true, reason: "Console provider — always \"configured\"; nothing is actually sent." };
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    if (message.to.includes("+delivery-fail")) {
      throw new EmailDeliveryError({
        code: "simulated_failure",
        message: "Simulated delivery failure (recipient address contains \"+delivery-fail\") — test hook, not a real provider error.",
        retryable: true,
      });
    }

    logger.info("Email not actually sent — no real email provider configured (using console provider).", {
      operation: "mail.send",
      to: message.to,
      subject: message.subject,
    });
    if (serverEnv.NODE_ENV !== "production") {
      // Deliberate dev-only console output, not a logging call (see file
      // comment) — makes the email body visible in the terminal running
      // `next dev` without needing a real inbox.
      console.log(`\n----- [dev mail, provider=console] to: ${message.to} | subject: ${message.subject} -----\n${message.text}\n-----------------------------------------------------------\n`);
    }
    return { accepted: true, providerMessageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }
}

/**
 * The configured provider. `EMAIL_PROVIDER` (`config/environment.ts`)
 * selects it — today only `"console"` has a real implementation; any
 * other value (or unset) falls back to the console provider with a
 * warning, rather than throwing at boot (this module's job is to prove
 * the contract, not to require a real provider to exist yet — see
 * notifications.md "What was deliberately not built"). Every call site
 * imports `emailProvider`, never a concrete provider class directly, so
 * swapping in a real one later touches this one file.
 */
function resolveEmailProvider(): EmailProvider {
  const configured = serverEnv.EMAIL_PROVIDER ?? "console";
  if (configured !== "console") {
    logger.warn("EMAIL_PROVIDER is set to an unimplemented provider — falling back to the console provider.", {
      operation: "mail.resolveProvider",
      configured,
    });
  }
  return new ConsoleEmailProvider();
}

export const emailProvider: EmailProvider = resolveEmailProvider();

/**
 * The two email-sending operations Module 04 needs. Callers never build
 * the raw email text inline — keeping subject/body copy here means a
 * later real-provider swap (HTML templates, localization) touches one
 * file, not every service that triggers an email.
 *
 * Neither function logs `verificationUrl`/`resetUrl` beyond what
 * `ConsoleEmailProvider` already does in non-production — see
 * docs/architecture/authentication.md "Token storage" for why a token
 * must never appear in a production log line.
 */
export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
  await emailProvider.send({
    to,
    subject: "Verify your Alpha OS email address",
    text: `Welcome to Alpha OS. Verify your email address by visiting:\n\n${verificationUrl}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await emailProvider.send({
    to,
    subject: "Reset your Alpha OS password",
    text: `We received a request to reset your Alpha OS password. Visit the link below to choose a new one:\n\n${resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, you can ignore this email — your password hasn't been changed.`,
  });
}

/**
 * Module 07 — invitation delivery. Goes through the same `emailProvider`
 * every other transactional email in this app does — see that module's
 * own reasoning, unchanged by this file's Module 09 extension.
 */
export async function sendInvitationEmail(to: string, organizationName: string, acceptUrl: string): Promise<void> {
  await emailProvider.send({
    to,
    subject: `You've been invited to join ${organizationName} on Alpha OS`,
    text: `You've been invited to join ${organizationName} on Alpha OS. Accept the invitation by visiting:\n\n${acceptUrl}\n\nThis link expires in 7 days. If you weren't expecting this, you can ignore this email.`,
  });
}
