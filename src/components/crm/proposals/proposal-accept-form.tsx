"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptProposalAction } from "@/app/(protected)/admin/crm/actions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CrmContact } from "@/generated/prisma/client";

const UNASSIGNED = "__unassigned__";

/**
 * Records a REAL acceptance a staff member obtained outside Alpha OS
 * (verbal/email/in-person) — this is `INTERNAL_RECORDED` acceptance, not
 * a customer-facing e-signature flow (Build 22 has none — see
 * docs/architecture/proposals-contracts.md "E-signature readiness").
 * The form is deliberately explicit about this so staff never mistake
 * it for collecting a live signature.
 */
export function ProposalAcceptForm({ proposalId, contacts, defaultContactId }: { proposalId: string; contacts: CrmContact[]; defaultContactId: string | null }) {
  const [acceptedByContactId, setAcceptedByContactId] = useState(defaultContactId ?? UNASSIGNED);
  const defaultContact = contacts.find((c) => c.id === defaultContactId);
  const [signerName, setSignerName] = useState(defaultContact ? `${defaultContact.firstName} ${defaultContact.lastName}` : "");
  const [signerEmail, setSignerEmail] = useState(defaultContact?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleContactChange(id: string) {
    setAcceptedByContactId(id);
    const contact = contacts.find((c) => c.id === id);
    if (contact) {
      setSignerName(`${contact.firstName} ${contact.lastName}`);
      setSignerEmail(contact.email ?? "");
    }
  }

  function handleSubmit() {
    if (!signerName.trim() || !signerEmail.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await acceptProposalAction({
        proposalId,
        acceptedByContactId: acceptedByContactId === UNASSIGNED ? undefined : acceptedByContactId,
        acceptedSignerName: signerName,
        acceptedSignerEmail: signerEmail,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success/5 p-3">
      <p className="text-sm font-medium">Record customer acceptance</p>
      <p className="text-xs text-muted-foreground">Records that the customer accepted this proposal outside Alpha OS (verbal, email, or in-person) — not a live e-signature capture.</p>
      {contacts.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-contact">Accepted by</Label>
          <Select value={acceptedByContactId} onValueChange={handleContactChange} disabled={pending}>
            <SelectTrigger id="accept-contact" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNASSIGNED}>Someone not in the contact list</SelectItem>
              {contacts.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-signer-name">Signer name</Label>
          <Input id="accept-signer-name" value={signerName} onChange={(e) => setSignerName(e.target.value)} disabled={pending} maxLength={200} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-signer-email">Signer email</Label>
          <Input id="accept-signer-email" type="email" value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} disabled={pending} maxLength={320} />
        </div>
      </div>
      <Button size="sm" className="w-fit" disabled={pending || !signerName.trim() || !signerEmail.trim()} onClick={handleSubmit}>
        Record acceptance
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
