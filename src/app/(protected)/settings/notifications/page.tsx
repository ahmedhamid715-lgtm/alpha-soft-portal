import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notificationService } from "@/lib/notifications/service";
import { NOTIFICATION_CATEGORY_KEYS, getNotificationCategoryDefinition } from "@/lib/notifications/categories";
import { PreferenceToggle } from "@/components/notifications/preference-toggle";
import type { NotificationChannel } from "@/generated/prisma/client";

export const metadata: Metadata = { title: "Notification preferences" };

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  IN_APP: "In-app",
  EMAIL: "Email",
  SMS: "SMS",
  PUSH: "Push",
};

/**
 * `/settings/notifications` (spec section 13) — grouped by category
 * `group` (Security, Organization, System, Marketing), each row a
 * channel that category supports. A mandatory channel renders a locked
 * "Required" badge, never a toggle a user could flip and have silently
 * ignored — the server (`notificationService.updatePreference()`)
 * enforces the identical rule; this page never computes "is this
 * mandatory" independently (`isChannelMandatory()`/`resolveChannels()`
 * in `lib/notifications/policy.ts` is the one place that's decided).
 */
export default async function NotificationPreferencesPage() {
  const preferences = await notificationService.listPreferences();
  const stored = new Map(preferences.map((p) => [`${p.category}:${p.channel}`, p.enabled]));

  const groups = new Map<string, (typeof NOTIFICATION_CATEGORY_KEYS)[number][]>();
  for (const key of NOTIFICATION_CATEGORY_KEYS) {
    const def = getNotificationCategoryDefinition(key);
    const list = groups.get(def.group) ?? [];
    list.push(key);
    groups.set(def.group, list);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Notification preferences"
        description="Control how Alpha OS reaches you, by category and channel. Security-critical notifications can't be turned off."
        breadcrumbs={[{ label: "Account", href: "/settings/account" }, { label: "Notifications" }]}
      />

      {[...groups.entries()].map(([group, keys]) => (
        <section key={group} className="flex flex-col gap-4">
          <SectionHeader title={group} />
          <div className="flex flex-col gap-4">
            {keys.map((key) => {
              const def = getNotificationCategoryDefinition(key);
              return (
                <Card key={key} className="max-w-2xl">
                  <CardContent className="flex flex-col gap-1">
                    <p className="text-sm font-medium">{def.label}</p>
                    <p className="pb-2 text-sm text-muted-foreground">{def.description}</p>
                    <div className="flex flex-col divide-y divide-border">
                      {def.supportedChannels.map((channel) => {
                        const mandatory = def.mandatoryChannels.includes(channel);
                        const enabled = stored.get(`${key}:${channel}`) ?? def.defaultEnabled[channel] ?? false;
                        return mandatory ? (
                          <div key={channel} className="flex items-center justify-between gap-4 py-2">
                            <span className="text-sm text-foreground">{CHANNEL_LABEL[channel]}</span>
                            <Badge variant="outline" className="gap-1 text-muted-foreground">
                              <Lock className="size-3" aria-hidden="true" />
                              Required
                            </Badge>
                          </div>
                        ) : (
                          <PreferenceToggle key={channel} category={key} channel={channel} label={CHANNEL_LABEL[channel]} checked={enabled} />
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
