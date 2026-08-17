/**
 * Next.js's official one-time server-startup hook (`register()`, called
 * once per server instance before it accepts requests — see
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation).
 * The first real use in Alpha OS: registering Module 09's notification
 * subscribers on the shared `events` bus (`lib/platform/events.ts`).
 * Every existing `events.emit()` call site (Module 05/07/08) predates
 * this file and is completely unaffected — this only ADDS listeners,
 * it never changes how `emit()`/`on()` themselves behave.
 *
 * Edge-runtime guarded: the subscriber module transitively imports
 * Prisma/server-only database code, which does not run on the Edge
 * runtime `instrumentation.ts` can also be loaded under — see the
 * Next.js docs' own "Specifying the runtime" example for this exact
 * pattern.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/lib/notifications/subscribers");
  }
}
