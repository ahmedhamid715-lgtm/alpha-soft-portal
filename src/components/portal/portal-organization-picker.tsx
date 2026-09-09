"use client";

import { useActionState } from "react";
import { Building2, AlertCircle } from "lucide-react";
import { switchPortalOrganizationAction, type PortalActionState } from "@/app/(protected)/portal/actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { PortalEligibleOrganization } from "@/lib/portal/context";

const initialState: PortalActionState = {};

/** One row per organization the caller could legitimately switch the Portal to — each its own tiny form/submit, not a single dropdown + separate submit button, so a single click is enough. */
export function PortalOrganizationPicker({ organizations }: { organizations: PortalEligibleOrganization[] }) {
  const [state, formAction, pending] = useActionState(switchPortalOrganizationAction, initialState);

  return (
    <div className="flex flex-col gap-3 max-w-md">
      {state.error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      {organizations.map((org) => (
        <form key={org.id} action={formAction}>
          <input type="hidden" name="organizationId" value={org.id} />
          <Card>
            <CardContent className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">{org.displayName}</span>
              </div>
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                Continue
              </Button>
            </CardContent>
          </Card>
        </form>
      ))}
    </div>
  );
}
