import { StatusBadge } from "@/components/shared/status-badge";
import { formatMoney } from "@/lib/utils/money";
import { formatInTimeZone } from "@/lib/utils/datetime";
import { proposalStatusVariant } from "./proposal-status";
import type { CrmProposalVersionWithRelations } from "@/server/repositories/crm-proposal-version-repository";

/** Every version of a proposal, newest first — the visible "revision history" the master prompt's own versioning requirement calls for. Not interactive; each row is a historical, immutable-once-sent record. */
export function ProposalVersionHistory({ versions, currentVersionId }: { versions: CrmProposalVersionWithRelations[]; currentVersionId: string | null }) {
  if (versions.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Proposal version history, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Version</th>
            <th className="px-4 py-2.5">Status</th>
            <th className="px-4 py-2.5">Total</th>
            <th className="px-4 py-2.5">Created</th>
            <th className="px-4 py-2.5">By</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((version) => (
            <tr key={version.id} className="border-b border-border last:border-0">
              <td className="px-4 py-2.5 font-medium">
                v{version.versionNumber}
                {version.id === currentVersionId ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">(current)</span> : null}
              </td>
              <td className="px-4 py-2.5">
                <StatusBadge status={proposalStatusVariant(version.status)}>{version.status}</StatusBadge>
              </td>
              <td className="px-4 py-2.5 tabular-nums">{formatMoney(version.totalMinorUnits, version.currency)}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{formatInTimeZone(version.createdAt, "UTC")}</td>
              <td className="px-4 py-2.5 text-muted-foreground">{version.createdByUser.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
