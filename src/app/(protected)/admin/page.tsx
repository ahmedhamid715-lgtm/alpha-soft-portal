import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin" };

/** Placeholder — see (protected)/layout.tsx. Module 09 builds the real Admin Command Center. */
export default function AdminPlaceholderPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="text-muted-foreground">
        Authenticated and routed here because your organization role is <code>owner</code> or <code>admin</code>.
        This is a Module 04 verification placeholder — Module 09 builds the real Admin Command Center.
      </p>
    </div>
  );
}
