"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, Star } from "lucide-react";
import { recordLocalReviewAction, draftLocalReviewResponseAction, confirmLocalReviewResponseAction } from "../../../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import type { LocalReview } from "@/generated/prisma/client";

const RESPONSE_TONE: Record<string, "success" | "warning" | "neutral"> = { RESPONDED: "success", DRAFTED: "warning", NONE: "neutral" };

/**
 * Individual review records (Build 31 — Roadmap Module 25). Staff can
 * draft a response and later confirm it was actually posted externally
 * — this never publishes anything to Google itself (no "Reply on
 * Google" action; no provider API integration exists).
 */
export function ReviewsTab({ locationId, initialItems, canManageMeasurements }: { locationId: string; initialItems: LocalReview[]; canManageMeasurements: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const router = useRouter();
  const ratingId = useId();
  const reviewerId = useId();
  const textId = useId();
  const reviewedAtId = useId();

  function runAction(action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error ?? null);
      if (!result.error) {
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function handleAdd(formData: FormData) {
    const rating = formData.get("rating");
    const reviewerDisplayName = formData.get("reviewerDisplayName");
    const text = formData.get("text");
    const reviewedAt = formData.get("reviewedAt");
    runAction(
      () =>
        recordLocalReviewAction({
          locationId,
          rating: typeof rating === "string" ? rating : "5",
          reviewerDisplayName: typeof reviewerDisplayName === "string" && reviewerDisplayName.length > 0 ? reviewerDisplayName : null,
          text: typeof text === "string" && text.length > 0 ? text : null,
          reviewedAt: typeof reviewedAt === "string" && reviewedAt.length > 0 ? `${reviewedAt}T00:00:00.000Z` : null,
        }),
      () => setShowAdd(false),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {canManageMeasurements ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            Record review
          </Button>
        </div>
      ) : null}

      {showAdd ? (
        <Card>
          <CardContent>
            <form action={handleAdd} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={ratingId}>Rating</Label>
                <select id={ratingId} name="rating" defaultValue="5" disabled={pending} className="h-9 rounded-md border border-input bg-transparent px-3 text-sm">
                  {[5, 4, 3, 2, 1].map((r) => (
                    <option key={r} value={r}>
                      {r} star{r === 1 ? "" : "s"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={reviewedAtId}>Date (optional)</Label>
                <Input id={reviewedAtId} name="reviewedAt" type="date" disabled={pending} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={reviewerId}>Reviewer display name (optional)</Label>
                <Input id={reviewerId} name="reviewerDisplayName" disabled={pending} className="w-48" />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label htmlFor={textId}>Review text (optional)</Label>
                <Input id={textId} name="text" disabled={pending} />
              </div>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Save
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {initialItems.length === 0 ? (
        <EmptyState icon={Star} title="No reviews recorded yet" description="Record reviews to track rating trends and response coverage." />
      ) : (
        <div className="flex flex-col gap-2">
          {initialItems.map((review) => (
            <Card key={review.id}>
              <CardContent className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)}
                    {review.reviewerDisplayName ? ` — ${review.reviewerDisplayName}` : ""}
                  </span>
                  <StatusBadge status={RESPONSE_TONE[review.responseStatus]}>{review.responseStatus}</StatusBadge>
                </div>
                {review.text ? <p className="text-xs text-muted-foreground">{review.text}</p> : null}
                {review.reviewedAt ? <p className="text-xs text-muted-foreground">Reviewed {review.reviewedAt.toISOString().slice(0, 10)}</p> : null}
                {review.responseText ? <p className="border-t pt-2 text-xs text-muted-foreground">Response: {review.responseText}</p> : null}
                {canManageMeasurements ? (
                  <div className="flex flex-wrap gap-2">
                    {review.responseStatus !== "RESPONDED" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRespondingTo(respondingTo === review.id ? null : review.id)}>
                        {review.responseStatus === "DRAFTED" ? "Edit response" : "Draft response"}
                      </Button>
                    ) : null}
                    {review.responseStatus === "DRAFTED" ? (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => runAction(() => confirmLocalReviewResponseAction({ reviewId: review.id }))}>
                        Confirm published on Google
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {respondingTo === review.id ? <RespondForm reviewId={review.id} onDone={() => setRespondingTo(null)} onError={setError} /> : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RespondForm({ reviewId, onDone, onError }: { reviewId: string; onDone: () => void; onError: (e: string | null) => void }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const textId = useId();

  function handleSubmit(formData: FormData) {
    const responseText = formData.get("responseText");
    startTransition(async () => {
      const result = await draftLocalReviewResponseAction({ reviewId, responseText: typeof responseText === "string" ? responseText : "" });
      onError(result.error ?? null);
      if (!result.error) {
        onDone();
        router.refresh();
      }
    });
  }

  return (
    <form action={handleSubmit} className="flex items-end gap-2 border-t pt-2">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor={textId}>Draft response text</Label>
        <Textarea id={textId} name="responseText" required disabled={pending} rows={2} />
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        Save draft
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
        Cancel
      </Button>
    </form>
  );
}
