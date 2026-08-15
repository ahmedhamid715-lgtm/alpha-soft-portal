import { describe, expect, it } from "vitest";
import { formatInTimeZone, isValidTimeZone, nowUtc, toIsoUtc } from "@/lib/utils/datetime";

describe("datetime", () => {
  it("nowUtc returns a real Date", () => {
    expect(nowUtc()).toBeInstanceOf(Date);
  });

  it("toIsoUtc serializes to an ISO 8601 UTC string", () => {
    const date = new Date("2026-03-01T12:00:00.000Z");
    expect(toIsoUtc(date)).toBe("2026-03-01T12:00:00.000Z");
  });

  it("formats the same instant differently in different timezones", () => {
    const date = new Date("2026-06-15T18:30:00.000Z");
    const nyc = formatInTimeZone(date, "America/New_York");
    const tokyo = formatInTimeZone(date, "Asia/Tokyo");
    expect(nyc).not.toBe(tokyo);
  });

  it("validates real IANA timezone names", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Europe/London")).toBe(true);
  });

  it("rejects garbage timezone input", () => {
    expect(isValidTimeZone("Not/A_Real_Zone")).toBe(false);
  });
});
