import { z } from "zod";
// Import from app-error.ts directly, not the `@/lib/errors` barrel — that
// barrel also re-exports api-response.ts, which is marked "server-only".
// ValidationError itself has no server-only dependency, so this file stays
// safe to import from client components (e.g. inline form validation).
import { ValidationError } from "@/lib/errors/app-error";

/**
 * The one supported way to validate input at a trust boundary (spec
 * section 19): API request bodies, query params, form submissions,
 * webhook payloads, external config. Never trust client input — always
 * run it through a Zod schema and this helper before using it.
 *
 * Throws a `ValidationError` (400, safe to serialize) with a field-level
 * breakdown on failure, so every future endpoint gets identical
 * validation-error responses for free via the API error contract.
 */
export function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): z.infer<Schema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "(root)";
      (fieldErrors[path] ??= []).push(issue.message);
    }

    throw new ValidationError("The provided input is invalid.", {
      details: { fieldErrors },
    });
  }

  return result.data;
}

/**
 * Same as `parseOrThrow`, but for code paths that want a Result-style
 * return instead of a thrown error (e.g. client-side form handlers that
 * shouldn't import a server-only error class).
 */
export function safeParseResult<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): { success: true; data: z.infer<Schema> } | { success: false; fieldErrors: Record<string, string[]> } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const fieldErrors: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".") || "(root)";
    (fieldErrors[path] ??= []).push(issue.message);
  }
  return { success: false, fieldErrors };
}

/**
 * An empty string and an absent key must validate identically — every
 * one of these filters ultimately comes from a URL search-param object
 * or a plain `<form method="get">`'s submission, where a `<select>`
 * with an "Any status"/"All categories"-style unselected `<option
 * value="">` still submits its `name` with an empty string, not no key
 * at all. Without this, `z.enum([...]).optional()` on `""` doesn't skip
 * validation (only a genuinely `undefined` value does), so the *whole
 * request* crashes the moment a user submits a filter form with nothing
 * chosen — the common case. Originally `audit/query.ts`'s own local
 * helper (found there by actually clicking through that filter form in
 * a real browser); promoted here once `notification-observability`'s
 * and `user-management`'s own filter schemas needed the identical fix,
 * caught the same way — see `docs/architecture/user-management.md`
 * "Real bugs found."
 */
export function optionalFromQueryParam<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}
