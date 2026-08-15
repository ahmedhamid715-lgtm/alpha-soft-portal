/**
 * Navigation configuration scaffold.
 *
 * No dashboards exist yet (Module 09/18/20 build the admin, support, and
 * customer shells). This file establishes the *shape* future modules
 * should register their nav items into, so navigation stays data-driven
 * instead of hard-coded JSX scattered across layout files. The rendering
 * side (AppSidebar, Module 02) is intentionally unaware of "admin" /
 * "support" / "customer" — it renders whatever `NavItem[]` it's handed.
 */

export type NavSection = "admin" | "support" | "customer";

export interface NavItem {
  /** Unique, stable key — used for active-state matching and testing. */
  key: string;
  label: string;
  href: string;
  /** Name resolved via components/layout/nav-icons.ts — never a JSX icon reference. */
  icon?: string;
  /** Feature flag key gating visibility of this item, if any. */
  featureFlag?: string;
  /** A count/label badge, e.g. unread tickets. Rendered as-is — format upstream. */
  badge?: string | number;
  /** One level of nested items (spec: "nested navigation") — rendered as a collapsible group. */
  children?: NavItem[];
}

export type NavigationConfig = Record<NavSection, NavItem[]>;

/**
 * Populated by later modules (09 Admin Command Center, 32 Support Team,
 * 20 Customer Portal). Intentionally empty in Module 01/02 — the
 * /design-system showcase route uses its own local sample data instead of
 * writing real entries here, since real entries belong to the module that
 * owns each route.
 */
export const navigation: NavigationConfig = {
  admin: [],
  support: [],
  customer: [],
};
