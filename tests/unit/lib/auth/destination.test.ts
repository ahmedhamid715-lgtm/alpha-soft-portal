import { describe, expect, it } from "vitest";
import { resolveDestination, DESTINATIONS } from "@/lib/auth/destination";

const ORG_ID = "018f2b6e-0000-7000-8000-000000000000";

describe("resolveDestination", () => {
  it("routes ORGANIZATION-scope owner/admin to THEIR OWN organization, never the platform-only admin destination", () => {
    // Found live, not by inspection — an org-scoped admin used to land
    // on `/admin`'s "No platform tools available" dead end, since
    // `/admin` is exclusively platform-scope tooling. See this file's
    // own top comment.
    expect(resolveDestination({ role: "owner", organizationId: ORG_ID })).toBe(`/organizations/${ORG_ID}`);
    expect(resolveDestination({ role: "admin", organizationId: ORG_ID })).toBe(`/organizations/${ORG_ID}`);
  });

  it("routes the legacy pre-Module-05 support role key to the support destination", () => {
    expect(resolveDestination({ role: "support", organizationId: ORG_ID })).toBe(DESTINATIONS.support);
  });

  it("routes PLATFORM-scope platform_owner/platform_admin roles to the admin destination", () => {
    expect(resolveDestination({ role: "platform_owner", organizationId: ORG_ID })).toBe(DESTINATIONS.admin);
    expect(resolveDestination({ role: "platform_admin", organizationId: ORG_ID })).toBe(DESTINATIONS.admin);
  });

  it("routes PLATFORM-scope support_admin/support_agent roles to the support destination", () => {
    expect(resolveDestination({ role: "support_admin", organizationId: ORG_ID })).toBe(DESTINATIONS.support);
    expect(resolveDestination({ role: "support_agent", organizationId: ORG_ID })).toBe(DESTINATIONS.support);
  });

  it("routes ORGANIZATION-scope member/viewer/manager/customer roles to the customer destination", () => {
    expect(resolveDestination({ role: "member", organizationId: ORG_ID })).toBe(DESTINATIONS.customer);
    expect(resolveDestination({ role: "viewer", organizationId: ORG_ID })).toBe(DESTINATIONS.customer);
    expect(resolveDestination({ role: "manager", organizationId: ORG_ID })).toBe(DESTINATIONS.customer);
    expect(resolveDestination({ role: "customer", organizationId: ORG_ID })).toBe(DESTINATIONS.customer);
  });

  it("routes null (no resolvable membership) to the customer destination, never an internal one", () => {
    expect(resolveDestination(null)).toBe(DESTINATIONS.customer);
  });

  it("routes an unrecognized future role to the customer destination — the safe default, not an error", () => {
    expect(resolveDestination({ role: "some-future-role", organizationId: ORG_ID })).toBe(DESTINATIONS.customer);
  });
});
