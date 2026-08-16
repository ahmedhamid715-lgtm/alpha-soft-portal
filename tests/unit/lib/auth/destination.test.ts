import { describe, expect, it } from "vitest";
import { resolveDestination, DESTINATIONS } from "@/lib/auth/destination";

describe("resolveDestination", () => {
  it("routes owner and admin roles to the admin destination", () => {
    expect(resolveDestination("owner")).toBe(DESTINATIONS.admin);
    expect(resolveDestination("admin")).toBe(DESTINATIONS.admin);
  });

  it("routes the support role to the support destination", () => {
    expect(resolveDestination("support")).toBe(DESTINATIONS.support);
  });

  it("routes the member role to the customer destination", () => {
    expect(resolveDestination("member")).toBe(DESTINATIONS.customer);
  });

  it("routes null (no resolvable membership) to the customer destination, never an internal one", () => {
    expect(resolveDestination(null)).toBe(DESTINATIONS.customer);
  });

  it("routes an unrecognized future role to the customer destination — the safe default, not an error", () => {
    expect(resolveDestination("some-future-role")).toBe(DESTINATIONS.customer);
  });
});
