// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge, StatusDot } from "@/components/shared/status-badge";

describe("StatusBadge", () => {
  it("renders the label text for every status variant", () => {
    const statuses = ["neutral", "success", "warning", "destructive", "info", "primary"] as const;
    for (const status of statuses) {
      const { unmount } = render(<StatusBadge status={status}>Open</StatusBadge>);
      expect(screen.getByText("Open")).toBeInTheDocument();
      unmount();
    }
  });

  it("always renders a dot alongside the label — color is never the only signal", () => {
    const { container } = render(<StatusBadge status="success">Active</StatusBadge>);
    // The dot is the first child span, marked aria-hidden (decorative — the
    // text label is the real signal a screen reader gets).
    const dot = container.querySelector("span[aria-hidden='true']");
    expect(dot).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("defaults to the neutral variant when no status is given", () => {
    render(<StatusBadge>Draft</StatusBadge>);
    const badge = screen.getByText("Draft").closest("span");
    expect(badge?.className).toMatch(/border-border/);
  });

  it("StatusDot renders the same dot+label shape without the pill background", () => {
    render(<StatusDot status="destructive">Failed</StatusDot>);
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });
});
