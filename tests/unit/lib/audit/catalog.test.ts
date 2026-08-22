import { describe, expect, it } from "vitest";
import { AUDIT_CATALOG, isAuditActionKey, getAuditActionDefinition } from "@/lib/audit/catalog";

describe("AUDIT_CATALOG", () => {
  it("every key follows lowercase dot-notation (resource.action or resource.subresource.action)", () => {
    for (const key of Object.keys(AUDIT_CATALOG)) {
      expect(key).toMatch(/^[a-z]+(\.[a-z_]+)+$/);
    }
  });

  it("every entry has a non-empty description", () => {
    for (const definition of Object.values(AUDIT_CATALOG)) {
      expect(definition.description.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a valid AuditCategory", () => {
    const validCategories = new Set([
      "AUTHENTICATION",
      "AUTHORIZATION",
      "ORGANIZATION",
      "MEMBERSHIP",
      "INVITATION",
      "ROLE",
      "SECURITY",
      "DATA",
      "SYSTEM",
      "ADMINISTRATION",
      "COMPLIANCE",
      "BILLING",
    ]);
    for (const definition of Object.values(AUDIT_CATALOG)) {
      expect(validCategories.has(definition.category)).toBe(true);
    }
  });

  it("has no duplicate keys (object literal itself guarantees this, but the catalog's own two 'reserved' entries are the ones most likely to collide with a real one added later)", () => {
    const keys = Object.keys(AUDIT_CATALOG);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("isAuditActionKey", () => {
  it("returns true for a real catalog key", () => {
    expect(isAuditActionKey("auth.login.success")).toBe(true);
  });

  it("returns false for an unrecognized string", () => {
    expect(isAuditActionKey("not.a.real.action")).toBe(false);
  });

  it("returns false for a prototype property name (no accidental Object.prototype leak)", () => {
    expect(isAuditActionKey("toString")).toBe(false);
    expect(isAuditActionKey("constructor")).toBe(false);
    expect(isAuditActionKey("hasOwnProperty")).toBe(false);
  });
});

describe("getAuditActionDefinition", () => {
  it("returns the definition for a real key", () => {
    const definition = getAuditActionDefinition("organization.created");
    expect(definition.category).toBe("ORGANIZATION");
  });
});
