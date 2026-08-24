"use client";

import { useState, useTransition } from "react";
import { Search, FileText } from "lucide-react";
import { searchKnowledgeAction } from "./actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import type { RetrievalResult } from "@/server/services/knowledge-retrieval-service";

/** A real retrieval test box — calls the exact same `retrieveKnowledge()` a future AI feature would call, not a mock preview. Shows real provenance (which document/source each result came from) and honestly flags degraded (keyword-only) results when the embedding provider is unavailable. */
export function KnowledgeSearchBox({ organizationId }: { organizationId: string }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<RetrievalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSearch() {
    if (!query.trim()) return;
    setError(null);
    startTransition(async () => {
      const response = await searchKnowledgeAction({ organizationId, query });
      if (response.error) {
        setError(response.error);
        setResult(null);
        return;
      }
      setResult(response.result ?? null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this organization's knowledge…"
          aria-label="Search query"
          disabled={pending}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
        />
        <Button onClick={handleSearch} disabled={pending || !query.trim()}>
          <Search className="size-4" aria-hidden="true" />
          Search
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-2">
          {result.degraded ? (
            <Alert>
              <AlertDescription>Semantic search is currently unavailable (embedding provider unconfigured) — these are keyword-only results.</AlertDescription>
            </Alert>
          ) : null}
          {result.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching content found.</p>
          ) : (
            result.items.map((item) => (
              <Card key={item.chunkId}>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="size-3.5" aria-hidden="true" />
                      Document {item.documentId.slice(0, 8)}
                    </span>
                    <StatusBadge status="neutral">{item.matchedIn === 2 ? "keyword + semantic" : "single match"}</StatusBadge>
                  </div>
                  <p className="text-sm">{item.content}</p>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
