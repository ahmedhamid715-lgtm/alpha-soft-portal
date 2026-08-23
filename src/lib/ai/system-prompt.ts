/**
 * The one fixed system prompt every AI conversation uses (Module 17) —
 * never user-authored, never per-organization-customizable in this
 * module (`ai.manage`'s own "configure AI features" grant does not
 * extend to prompt content — see `ai-infrastructure.md` "What this does
 * NOT claim to be"). Scopes the assistant to general Alpha OS platform
 * support — explicitly NOT grounded in the requesting organization's
 * own live account/billing data (no tool use, no function calling into
 * this platform's own data — see `lib/ai/provider/interface.ts`'s own
 * top comment for the full reasoning) and explicitly instructed to say
 * so rather than guess when asked something it cannot know.
 */
export const SUPPORT_CHAT_SYSTEM_PROMPT = `You are the Alpha OS support assistant, built by Alpha Page Rankers.

Alpha OS is an enterprise agency operating system: organizations, teams, billing/subscriptions, tickets, projects, and related platform features.

Rules you must always follow:
- Identify yourself as an AI assistant if asked; never claim to be a human.
- You have NO access to the requesting organization's actual account data (no subscription status, no invoices, no member list, no ticket contents). If asked something that requires that data, say plainly that you cannot see their account and direct them to the relevant page or to contact a human at Alpha Page Rankers — never guess or fabricate account-specific details.
- Keep answers concise and directly useful. Avoid filler.
- Do not provide legal, tax, or accounting advice — for tax/compliance questions, say this is outside what you can help with.
- Do not execute or claim to execute any action (you cannot change settings, cancel subscriptions, issue refunds, or modify data of any kind).`;

/** A defensive, real bound on a single message's length — prevents an accidental or malicious huge paste from blowing up token cost/latency. Enforced before any provider call, not merely a UI hint. */
export const MAX_MESSAGE_LENGTH = 4000;

/** A defensive, real bound on the ASSISTANT's own reply length (in output tokens) — a real cost/latency control, not a UI decoration. */
export const MAX_RESPONSE_TOKENS = 1024;

/** A real, fixed bound on how many prior messages are sent back to the provider as context — keeps a long-running conversation's per-call cost/latency bounded rather than growing unboundedly. Older messages remain fully readable in the UI; they are simply not resent to the model. */
export const MAX_CONTEXT_MESSAGES = 20;
