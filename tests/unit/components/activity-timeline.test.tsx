// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActivityTimeline, type TimelineEntry } from "@/components/shared/activity-timeline";

const entries: TimelineEntry[] = [
  { id: "1", actor: { name: "Sarah Chen" }, action: "moved Website Redesign to On Track", timestamp: new Date("2026-08-15T13:48:00Z") },
];

describe("ActivityTimeline", () => {
  it("renders the actor name and action for each entry", () => {
    render(<ActivityTimeline entries={entries} />);
    expect(screen.getByText("Sarah Chen")).toBeInTheDocument();
    expect(screen.getByText("moved Website Redesign to On Track")).toBeInTheDocument();
  });

  it("sets <time dateTime> from the entry's timestamp exactly — not a wall-clock read", () => {
    render(<ActivityTimeline entries={entries} />);
    const time = document.querySelector("time");
    // This is the attribute that was flagged by React's hydration warning
    // when the source data used `Date.now() - N` (a fresh Date on every
    // module evaluation) — it must be a pure function of the prop.
    expect(time).toHaveAttribute("dateTime", "2026-08-15T13:48:00.000Z");
  });

  it("renders without throwing when an entry has no actor (icon-only, e.g. a system event)", () => {
    const systemEntry: TimelineEntry[] = [
      { id: "2", action: "Invoice #1042 was marked paid", timestamp: new Date("2026-08-15T09:00:00Z") },
    ];
    render(<ActivityTimeline entries={systemEntry} />);
    expect(screen.getByText("Invoice #1042 was marked paid")).toBeInTheDocument();
  });
});
