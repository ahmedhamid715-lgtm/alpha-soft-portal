import type { Metadata } from "next";

export const metadata: Metadata = { title: "Support" };

/** Placeholder — see (protected)/layout.tsx. Module 32 builds the real Support Team workspace. */
export default function SupportPlaceholderPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Support</h1>
      <p className="text-muted-foreground">
        Authenticated and routed here because your organization role is <code>support</code>. This is a
        Module 04 verification placeholder — Module 32 builds the real Support Team workspace.
      </p>
    </div>
  );
}
