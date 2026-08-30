"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { logActivityAction } from "@/app/(protected)/admin/crm/actions";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

const TYPES = [
  { value: "NOTE", label: "Note" },
  { value: "CALL", label: "Call" },
  { value: "EMAIL", label: "Email" },
  { value: "MEETING", label: "Meeting" },
] as const;

const CALL_OUTCOMES = [
  { value: "CONNECTED", label: "Connected" },
  { value: "VOICEMAIL", label: "Voicemail" },
  { value: "NO_ANSWER", label: "No answer" },
  { value: "WRONG_NUMBER", label: "Wrong number" },
] as const;

type ParentRef = { leadId: string } | { companyId: string } | { contactId: string };

/** One shared form for logging a `CrmActivity` against any of the three parent kinds — the `logActivity()` service itself enforces "exactly one parent," this form just narrows the caller's own `parentRef` shape to match. */
export function LogActivityForm({ parentRef }: { parentRef: ParentRef }) {
  const [type, setType] = useState<(typeof TYPES)[number]["value"]>("NOTE");
  const [body, setBody] = useState("");
  const [callOutcome, setCallOutcome] = useState<string>("CONNECTED");
  const [callDurationMinutes, setCallDurationMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await logActivityAction({
        ...parentRef,
        type,
        body: body || undefined,
        callOutcome: type === "CALL" ? callOutcome : undefined,
        callDurationSeconds: type === "CALL" && callDurationMinutes ? Number(callDurationMinutes) * 60 : undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
      setCallDurationMinutes("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="activity-type">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as typeof type)} disabled={pending}>
            <SelectTrigger id="activity-type" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {type === "CALL" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="call-outcome">Outcome</Label>
              <Select value={callOutcome} onValueChange={setCallOutcome} disabled={pending}>
                <SelectTrigger id="call-outcome" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CALL_OUTCOMES.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="call-duration">Duration (min)</Label>
              <Input id="call-duration" type="number" min={0} value={callDurationMinutes} onChange={(e) => setCallDurationMinutes(e.target.value)} disabled={pending} className="w-28" />
            </div>
          </>
        ) : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="activity-body">Notes</Label>
        <Textarea id="activity-body" value={body} onChange={(e) => setBody(e.target.value)} rows={2} disabled={pending} maxLength={4000} />
      </div>
      <Button onClick={handleSubmit} disabled={pending} className="w-fit">
        <Plus className="size-4" aria-hidden="true" />
        Log activity
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
