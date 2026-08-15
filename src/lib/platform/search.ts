import "server-only";

/**
 * Global search abstraction (spec section 28). Module 47 (Global Search)
 * implements this for real, indexing customers, contacts, projects,
 * tickets, documents, invoices, deals, tasks, messages, and SEO data.
 * Module 01 establishes only the interface, so every later module that
 * contributes searchable entities implements against a stable contract.
 *
 * The contract bakes in permission/tenant scoping from day one
 * (`actorUserId`/`organizationId` are required, not optional) — search
 * is one of the easiest places to accidentally leak cross-tenant data if
 * scoping is bolted on after the fact instead of designed in from the
 * start (see docs/architecture/security.md).
 */
export interface SearchResultItem {
  id: string;
  /** e.g. "customer" | "project" | "ticket" — extended by whichever module owns the entity. */
  type: string;
  title: string;
  description?: string;
  url: string;
  score?: number;
}

export interface SearchQuery {
  query: string;
  types?: string[];
  limit?: number;
  actorUserId: string;
  organizationId?: string;
}

export interface SearchProvider {
  search(query: SearchQuery): Promise<SearchResultItem[]>;
}

export class SearchNotConfiguredError extends Error {
  constructor() {
    super("No SearchProvider is configured yet. This lands in Module 47 (Global Search).");
    this.name = "SearchNotConfiguredError";
  }
}

class UnconfiguredSearchProvider implements SearchProvider {
  async search(): Promise<SearchResultItem[]> {
    throw new SearchNotConfiguredError();
  }
}

export const search: SearchProvider = new UnconfiguredSearchProvider();
