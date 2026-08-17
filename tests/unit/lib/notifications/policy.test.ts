import { describe, expect, it } from "vitest";
import { resolveChannels, isChannelMandatory, toPreferenceMap } from "@/lib/notifications/policy";
import { NOTIFICATION_CATEGORY_KEYS, getNotificationCategoryDefinition } from "@/lib/notifications/categories";

/**
 * The policy engine (spec section 10) — pure functions, no database, so
 * every category's mandatory/optional/default behavior is verified here
 * without needing Postgres. `notification-service.test.ts` (database
 * integration) proves this is actually WIRED to `notify()`; this file
 * proves the DECISION LOGIC itself is correct in isolation.
 */
describe("notification policy engine", () => {
  it("a mandatory channel is included even when the caller's own preference row explicitly says false", () => {
    const channels = resolveChannels("ACCOUNT_SECURITY", toPreferenceMap([{ category: "ACCOUNT_SECURITY", channel: "EMAIL", enabled: false } as never]));
    expect(channels).toContain("EMAIL");
  });

  it("an optional channel with no stored preference falls back to the category's own default", () => {
    // ORGANIZATION_ACTIVITY: EMAIL optional, default true.
    const enabledByDefault = resolveChannels("ORGANIZATION_ACTIVITY", toPreferenceMap([]));
    expect(enabledByDefault).toContain("EMAIL");

    // MARKETING: EMAIL optional, default false.
    const disabledByDefault = resolveChannels("MARKETING", toPreferenceMap([]));
    expect(disabledByDefault).not.toContain("EMAIL");
  });

  it("an optional channel honors an explicit stored preference over the category default", () => {
    const channels = resolveChannels("MARKETING", toPreferenceMap([{ category: "MARKETING", channel: "EMAIL", enabled: true } as never]));
    expect(channels).toContain("EMAIL");
  });

  it("never returns a channel the category doesn't support at all", () => {
    // SYSTEM only supports IN_APP — even an (invalid, but defensively
    // handled) stored EMAIL=true preference for this category must not
    // produce an EMAIL delivery, because `supportedChannels` is the
    // outer bound `resolveChannels()` iterates, not the preference map.
    const channels = resolveChannels("SYSTEM", toPreferenceMap([{ category: "SYSTEM", channel: "EMAIL", enabled: true } as never]));
    expect(channels).toEqual(["IN_APP"]);
  });

  it("isChannelMandatory() agrees with each category's own mandatoryChannels list — the preferences UI's source of truth", () => {
    for (const key of NOTIFICATION_CATEGORY_KEYS) {
      const def = getNotificationCategoryDefinition(key);
      for (const channel of def.supportedChannels) {
        expect(isChannelMandatory(key, channel)).toBe(def.mandatoryChannels.includes(channel));
      }
    }
  });

  it("every category supports IN_APP and marks it mandatory — a created notification is always visible in the recipient's own feed", () => {
    for (const key of NOTIFICATION_CATEGORY_KEYS) {
      const def = getNotificationCategoryDefinition(key);
      expect(def.supportedChannels).toContain("IN_APP");
      expect(def.mandatoryChannels).toContain("IN_APP");
    }
  });
});
