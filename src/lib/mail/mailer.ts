import "server-only";
import { serverEnv } from "@/config/environment";
import { logger } from "@/lib/logging";

/**
 * Server-only mail abstraction (spec section 27). Nothing in Alpha OS
 * has a configured email provider yet — this interface is what Module 04
 * (and later, transactional-email needs from other modules) codes
 * against, so plugging in a real provider (Resend, Postmark, SES, ...)
 * later means implementing this interface once, not rewriting every
 * call site that currently imports `mailer`.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text — no HTML templating exists yet; add it to a real provider implementation, not here. */
  text: string;
}

export interface MailProvider {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development-only provider: logs the message (never the raw token —
 * see below) and, in non-production environments, returns the message
 * unchanged for the caller to optionally surface a dev-only verification
 * link (see `(public)/verify-email` and the password-reset flow) rather
 * than requiring a real inbox to test the app locally. This is NOT a
 * silent success stand-in for a broken provider — it genuinely is the
 * configured provider until a real one is wired up, and it says so in
 * its own log line.
 */
class ConsoleMailProvider implements MailProvider {
  async send(message: MailMessage): Promise<void> {
    logger.info("Email not actually sent — no mail provider configured.", {
      operation: "mail.send",
      to: message.to,
      subject: message.subject,
    });
    if (serverEnv.NODE_ENV !== "production") {
      // Deliberate dev-only console output, not a logging call (see file
      // comment) — makes the email body visible in the terminal running
      // `next dev` without needing a real inbox.
      console.log(`\n----- [dev mail] to: ${message.to} | subject: ${message.subject} -----\n${message.text}\n-----------------------------------------------------------\n`);
    }
  }
}

/**
 * Swap this for a real provider once one is configured — every call site
 * imports `mailer`, never a concrete provider class directly.
 */
export const mailer: MailProvider = new ConsoleMailProvider();

/**
 * The two email-sending operations Module 04 needs. Callers never build
 * the raw email text inline — keeping subject/body copy here means a
 * later real-provider swap (HTML templates, localization) touches one
 * file, not every service that triggers an email.
 *
 * Neither function logs `verificationUrl`/`resetUrl` beyond what
 * `ConsoleMailProvider` already does in non-production — see
 * docs/architecture/authentication.md "Token storage" for why a token
 * must never appear in a production log line.
 */
export async function sendVerificationEmail(to: string, verificationUrl: string): Promise<void> {
  await mailer.send({
    to,
    subject: "Verify your Alpha OS email address",
    text: `Welcome to Alpha OS. Verify your email address by visiting:\n\n${verificationUrl}\n\nThis link expires in 24 hours. If you didn't create this account, you can ignore this email.`,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await mailer.send({
    to,
    subject: "Reset your Alpha OS password",
    text: `We received a request to reset your Alpha OS password. Visit the link below to choose a new one:\n\n${resetUrl}\n\nThis link expires in 1 hour and can only be used once. If you didn't request this, you can ignore this email — your password hasn't been changed.`,
  });
}

/**
 * Module 07 — invitation delivery (spec section 13: "do not build a full
 * email delivery provider... create an abstraction/event contract for
 * Module 09"). This function IS that abstraction for now — it goes
 * through the same `mailer`/`ConsoleMailProvider` every other
 * transactional email in this app already does, so swapping in a real
 * provider later (Module 09) touches this one file, not every invite
 * call site. `invitation-service.ts` also emits a
 * `"organization.member.invited"` domain event alongside calling this —
 * see that file and `docs/architecture/invitations.md` "Notification
 * boundary" for why both exist (this is delivery; the event is what a
 * future Module 09 notification *subscriber* reacts to instead of
 * polling this function).
 */
export async function sendInvitationEmail(to: string, organizationName: string, acceptUrl: string): Promise<void> {
  await mailer.send({
    to,
    subject: `You've been invited to join ${organizationName} on Alpha OS`,
    text: `You've been invited to join ${organizationName} on Alpha OS. Accept the invitation by visiting:\n\n${acceptUrl}\n\nThis link expires in 7 days. If you weren't expecting this, you can ignore this email.`,
  });
}
