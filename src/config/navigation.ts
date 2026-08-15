/**
 * Navigation configuration scaffold.
 *
 * No dashboards exist yet (Module 09/18/20 build the admin, support, and
 * customer shells). This file establishes the *shape* future modules
 * should register their nav items into, so navigation stays data-driven
 * instead of hard-coded JSX scattered across layout files.
 */

export type NavSection = "admin" | "support" | "customer";

export interface NavItem {
  /** Unique, stable key — used for active-state matching and testing. */
  key: string;
  label: string;
  href: string;
  /** Lucide icon name, resolved by the nav-rendering component. */
  icon?: string;
  /** Feature flag key gating visibility of this item, if any. */
  featureFlag?: string;
}

export type NavigationConfig = Record<NavSection, NavItem[]>;

/**
 * Populated by later modules (09 Admin Command Center, 32 Support Team,
 * 20 Customer Portal). Intentionally empty in Module 01.
 */
export const navigation: NavigationConfig = {
  admin: [],
  support: [],
  customer: [],
};
