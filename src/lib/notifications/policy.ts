import type { NotificationChannel, NotificationPreference } from "@/generated/prisma/client";
import { getNotificationCategoryDefinition, type NotificationCategoryKey } from "./categories";

/**
 * The policy engine (spec section 10) — answers exactly two questions,
 * server-side, always: "should this notification even be created?" and
 * "which channels should be attempted?" Explicit, typed categories
 * (`categories.ts`), not a generic rules engine — spec's own instruction
 * ("do not implement a huge generic rules engine").
 *
 * Never trust a client-supplied preference — this function's only inputs
 * are the category (server-resolved, from the template that's creating
 * the notification) and the recipient's OWN preference rows, already
 * fetched server-side by `notificationPreferenceRepository`.
 */

/** A quick lookup structure `resolveChannels()` needs — build once per call from the raw preference rows, not once per channel. */
export function toPreferenceMap(preferences: NotificationPreference[]): Map<NotificationChannel, boolean> {
  const map = new Map<NotificationChannel, boolean>();
  for (const pref of preferences) map.set(pref.channel, pref.enabled);
  return map;
}

/**
 * Which channels should actually be attempted for this category, given
 * this recipient's preferences. A mandatory channel is included
 * unconditionally — the stored preference (even an explicit `false`) is
 * never consulted for it. See `categories.ts`'s own doc comment for why
 * this is the enforcement point, not a database constraint that refuses
 * to let the row exist.
 */
export function resolveChannels(categoryKey: NotificationCategoryKey, preferences: Map<NotificationChannel, boolean>): NotificationChannel[] {
  const category = getNotificationCategoryDefinition(categoryKey);
  const channels: NotificationChannel[] = [];

  for (const channel of category.supportedChannels) {
    if (category.mandatoryChannels.includes(channel)) {
      channels.push(channel);
      continue;
    }
    const explicit = preferences.get(channel);
    const enabled = explicit ?? category.defaultEnabled[channel] ?? false;
    if (enabled) channels.push(channel);
  }

  return channels;
}

/** Whether a specific category/channel combination can be turned off at all — the preferences UI uses this to decide whether to render a toggle or a locked "Required" label. Server-side truth; the UI must not compute this independently. */
export function isChannelMandatory(categoryKey: NotificationCategoryKey, channel: NotificationChannel): boolean {
  return getNotificationCategoryDefinition(categoryKey).mandatoryChannels.includes(channel);
}
