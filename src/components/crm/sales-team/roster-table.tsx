import Link from "next/link";
import { StatusBadge } from "@/components/shared/status-badge";
import type { CrmSalesTeamMemberWithUser } from "@/server/repositories/crm-sales-team-member-repository";

export function RosterTable({ members }: { members: CrmSalesTeamMemberWithUser[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border" tabIndex={0} role="region" aria-label="Sales team roster, scrollable on narrow viewports">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Rep</th>
            <th className="px-4 py-2.5">Manager</th>
            <th className="px-4 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-2.5">
                <Link href={`/admin/crm/sales-team/${member.id}`} className="font-medium hover:underline">
                  {member.user.name}
                </Link>
                <div className="text-xs text-muted-foreground">{member.user.email}</div>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{member.manager?.user.name ?? "—"}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={member.status === "ACTIVE" ? "success" : "neutral"}>{member.status}</StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
