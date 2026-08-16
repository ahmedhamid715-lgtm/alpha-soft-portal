import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

/** Placeholder — see (protected)/layout.tsx. Module 20 builds the real Customer Portal. */
export default function DashboardPlaceholderPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-muted-foreground">
        Authenticated and routed here as the default customer-facing destination. This is a Module 04
        verification placeholder — Module 20 builds the real Customer Portal.
      </p>
    </div>
  );
}
