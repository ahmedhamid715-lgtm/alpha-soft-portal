"use client";

import { useState } from "react";
import { DataTable, createDataTableColumnHelper } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { MemberDetailSheet, type MemberDetail } from "./member-detail-sheet";

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleId: string | null;
  roleName: string;
  status: "ACTIVE" | "SUSPENDED";
  joinedAt: Date | null;
  isSelf: boolean;
}

const columnHelper = createDataTableColumnHelper<MemberRow>();

/**
 * Member directory (spec section 9) — searchable/sortable/paginated via
 * the existing `DataTable` (Module 02), never a bespoke table. Clicking
 * "Manage" opens `MemberDetailSheet` — the row itself never exposes
 * mutation controls directly, keeping the table dense and every
 * destructive action behind an explicit second step.
 */
export function MembersTable({
  organizationId,
  members,
  roleOptions,
  canManageRole,
  canManageStatus,
  canRemove,
}: {
  organizationId: string;
  members: MemberRow[];
  roleOptions: { id: string; name: string }[];
  canManageRole: boolean;
  canManageStatus: boolean;
  canRemove: boolean;
}) {
  const [selected, setSelected] = useState<MemberRow | null>(null);

  const columns = [
    // Derived value (`name email`), not the bare `name` field — the
    // global search box needs to match on email too (a real gap this
    // module's own E2E testing caught: searching an email substring
    // silently returned "No members yet" because only `name` was part
    // of any column's filterable value). `cell` still renders name and
    // email as two separate lines.
    columnHelper.accessor((row) => `${row.name} ${row.email}`, {
      id: "member",
      header: "Member",
      cell: (info) => (
        <div className="flex flex-col">
          <span className="font-medium">{info.row.original.name}</span>
          <span className="text-xs text-muted-foreground">{info.row.original.email}</span>
        </div>
      ),
    }),
    columnHelper.accessor("roleName", { header: "Role" }),
    columnHelper.accessor("status", {
      header: "Status",
      cell: (info) => <StatusBadge status={info.getValue() === "ACTIVE" ? "success" : "warning"}>{info.getValue()}</StatusBadge>,
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: (info) => (
        <Button variant="outline" size="sm" onClick={() => setSelected(info.row.original)}>
          Manage
        </Button>
      ),
    }),
  ];

  const detail: MemberDetail | null = selected
    ? {
        membershipId: selected.membershipId,
        userId: selected.userId,
        name: selected.name,
        email: selected.email,
        roleId: selected.roleId,
        roleName: selected.roleName,
        status: selected.status,
        joinedAt: selected.joinedAt,
      }
    : null;

  return (
    <>
      <DataTable
        columns={columns}
        data={members}
        searchPlaceholder="Search members…"
        emptyTitle="No members yet"
        emptyDescription="Members appear here once they join this organization."
        pageSize={10}
      />
      <MemberDetailSheet
        organizationId={organizationId}
        member={detail}
        roleOptions={roleOptions}
        canManageRole={canManageRole && !selected?.isSelf}
        canManageStatus={canManageStatus && !selected?.isSelf}
        canRemove={canRemove && !selected?.isSelf}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
