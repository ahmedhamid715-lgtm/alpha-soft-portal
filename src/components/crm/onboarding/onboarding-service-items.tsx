import type { CrmClientOnboardingServiceItem } from "@/generated/prisma/client";

/** Read-only — snapshotted once at conversion time from the accepted commercial terms (see the model's own schema comment). Never mutated here; `onboardingRequired`/`notes` are the only fields a future edit surface would touch, and Build 23 doesn't expose one yet. */
export function OnboardingServiceItems({ items }: { items: CrmClientOnboardingServiceItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No commercial line items to derive services from (this onboarding originated from a manually recorded agreement with no proposal).</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{item.title}</span>
            {item.description ? <span className="text-xs text-muted-foreground">{item.description}</span> : null}
          </div>
          <span className="text-sm tabular-nums text-muted-foreground">×{item.quantity}</span>
        </li>
      ))}
    </ul>
  );
}
