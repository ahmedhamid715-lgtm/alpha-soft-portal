// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppSidebar, type NavGroup } from "@/components/layout/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects/123",
}));

const groups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "dashboard" },
      { key: "projects", label: "Projects", href: "/projects", icon: "projects", badge: 12 },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        key: "analytics",
        label: "Analytics",
        href: "/analytics",
        icon: "analytics",
        children: [
          { key: "traffic", label: "Traffic", href: "/analytics/traffic" },
          { key: "revenue", label: "Revenue", href: "/analytics/revenue" },
        ],
      },
    ],
  },
];

function renderSidebar() {
  return render(
    // SidebarMenuButton's `tooltip` prop renders a Radix Tooltip, which
    // needs a TooltipProvider ancestor — provided once at the app root
    // (layout.tsx) in real usage.
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar roleLabel="Admin" groups={groups} />
      </SidebarProvider>
    </TooltipProvider>
  );
}

describe("AppSidebar", () => {
  it("marks the item matching the current pathname (by prefix) as active", () => {
    renderSidebar();
    // pathname is "/projects/123" — the "Projects" link (href "/projects")
    // should be active via the startsWith(`${href}/`) prefix match.
    const projectsLink = screen.getByRole("link", { name: /Projects/ });
    expect(projectsLink.closest("[data-active]")).toHaveAttribute("data-active", "true");
  });

  it("does not mark unrelated items as active", () => {
    renderSidebar();
    const dashboardLink = screen.getByRole("link", { name: "Dashboard" });
    expect(dashboardLink.closest("[data-active]")).toHaveAttribute("data-active", "false");
  });

  it("renders a badge/count when an item has one", () => {
    renderSidebar();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders nested children inside a proper <ul>/<li> structure (no <div> directly under the menu <ul>)", async () => {
    const user = userEvent.setup();
    const { container } = renderSidebar();
    const menus = container.querySelectorAll('[data-slot="sidebar-menu"]');
    expect(menus.length).toBeGreaterThan(0);
    // Every direct child of every menu list must be an <li> — a collapsible
    // group wrapping the <li> instead of nesting inside it was a real
    // list/listitem ARIA violation (see app-sidebar.tsx).
    for (const menu of Array.from(menus)) {
      for (const child of Array.from(menu.children)) {
        expect(child.tagName).toBe("LI");
      }
    }
    // The current mocked pathname ("/projects/123") doesn't match either
    // child, so the group starts collapsed — expand it to confirm the
    // children actually render once opened.
    await user.click(screen.getByRole("button", { name: /Analytics/ }));
    expect(screen.getByText("Traffic")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
  });
});
