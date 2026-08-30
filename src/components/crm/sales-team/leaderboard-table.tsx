import Link from "next/link";
import { formatMoney } from "@/lib/utils/money";
import type { LeaderboardEntry, LeaderboardMetric } from "@/server/services/crm-sales-performance-service";

function formatSortValue(entry: LeaderboardEntry, metric: LeaderboardMetric): string {
  if (entry.sortValue === null) return "Not measurable";
  switch (metric) {
    case "REVENUE_WON": {
      // The single largest currency total, matching `getSalesLeaderboard()`'s own
      // documented simplification — the currency itself is looked up from the row.
      const currency = entry.row.wonValueByCurrency.find((c) => c.totalMinorUnits === entry.sortValue)?.currency ?? "USD";
      return formatMoney(entry.sortValue, currency);
    }
    case "WIN_RATE":
      return `${entry.sortValue}%`;
    default:
      return String(entry.sortValue);
  }
}

/** Deterministic ranking table — see `getSalesLeaderboard()`'s own comment for the exact tie-break rule. A `null` sort value renders "Not measurable," never a fabricated last-place number. */
export function LeaderboardTable({ entries, metric }: { entries: LeaderboardEntry[]; metric: LeaderboardMetric }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Sales leaderboard, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Rank</th>
            <th className="px-4 py-2.5">Rep</th>
            <th className="px-4 py-2.5">Value</th>
            <th className="px-4 py-2.5">Deals won</th>
            <th className="px-4 py-2.5">Win rate</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.row.memberId} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2.5 tabular-nums text-muted-foreground">#{entry.rank}</td>
              <td className="px-4 py-2.5">
                <Link href={`/admin/crm/sales-team/${entry.row.memberId}`} className="font-medium hover:underline">
                  {entry.row.userName}
                </Link>
              </td>
              <td className="px-4 py-2.5 tabular-nums font-medium">{formatSortValue(entry, metric)}</td>
              <td className="px-4 py-2.5 tabular-nums">{entry.row.wonDealCount}</td>
              <td className="px-4 py-2.5 tabular-nums">{entry.row.winRatePercent === null ? "Not measurable" : `${entry.row.winRatePercent}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
