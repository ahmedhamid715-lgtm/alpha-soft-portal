/** Shared `StatusBadge` tone mapping for `KnowledgeIngestionStatus` — used by both the document detail page and any future knowledge UI that needs to render a version's processing state consistently. */
export const INGESTION_STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "destructive"> = {
  QUEUED: "neutral",
  PROCESSING: "neutral",
  CHUNKING: "neutral",
  EMBEDDING: "warning",
  READY: "success",
  FAILED: "destructive",
  SUPERSEDED: "neutral",
};
