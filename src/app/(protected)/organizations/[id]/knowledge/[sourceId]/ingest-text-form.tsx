"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { ingestTextAction } from "../actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

const MAX_CONTENT_LENGTH = 200_000;

/** Paste text directly, or pick a `.txt`/`.md` file — read entirely client-side via `File.text()` and submitted as the SAME plain-text `content` field. No upload/storage of the original file itself; only the extracted text is ever sent or persisted (see `knowledge-ingestion-service.ts` "Text-only ingestion"). */
export function IngestTextForm({ organizationId, sourceId }: { organizationId: string; sourceId: string }) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setContent(text.slice(0, MAX_CONTENT_LENGTH));
    if (!title.trim()) setTitle(file.name);
    e.target.value = "";
  }

  function handleSubmit() {
    if (!title.trim() || !content.trim()) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await ingestTextAction({ organizationId, sourceId, title, content });
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.deduplicated) {
        setNotice("This exact content was already ingested — nothing new was created.");
        return;
      }
      if (result.document) {
        setTitle("");
        setContent("");
        router.push(`/organizations/${organizationId}/knowledge/${sourceId}/${result.document.id}`);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doc-title">Title</Label>
        <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} disabled={pending} maxLength={300} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="doc-content">Content</Label>
        <Textarea id="doc-content" value={content} onChange={(e) => setContent(e.target.value.slice(0, MAX_CONTENT_LENGTH))} rows={8} disabled={pending} placeholder="Paste plain text or markdown…" />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {content.length.toLocaleString()}/{MAX_CONTENT_LENGTH.toLocaleString()}
          </span>
          <label className="text-xs text-link underline underline-offset-2 hover:cursor-pointer">
            or upload a .txt/.md file
            <input type="file" accept=".txt,.md,text/plain,text/markdown" onChange={handleFilePick} className="sr-only" disabled={pending} />
          </label>
        </div>
      </div>
      <Button onClick={handleSubmit} disabled={pending || !title.trim() || !content.trim()} className="w-fit">
        <Upload className="size-4" aria-hidden="true" />
        Ingest document
      </Button>
      {notice ? (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
