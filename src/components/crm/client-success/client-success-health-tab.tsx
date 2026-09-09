import { SectionHeader } from "@/components/layout/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { HeartPulse, ShieldAlert } from "lucide-react";
import { HEALTH_STATUS_LABELS, HEALTH_STATUS_TONE, CHURN_RISK_LABELS, CHURN_RISK_TONE, type HealthComponent, type CustomerHealthResult, type ChurnRiskResult } from "@/lib/crm/client-success";
import { ClientSuccessOwnerPanel } from "./client-success-owner-panel";
import { ClientSuccessRenewals } from "./client-success-renewals";
import { ClientSuccessExpansions } from "./client-success-expansions";
import type { User, CrmClientSuccessProfile } from "@/generated/prisma/client";
import type { CrmClientSuccessRenewalWithRelations } from "@/server/repositories/crm-client-success-renewal-repository";
import type { CrmClientSuccessExpansionWithRelations } from "@/server/repositories/crm-client-success-expansion-repository";

/**
 * The Client Success tab on Customer 360 (Build 25) — integrates INTO
 * the existing customer workspace rather than a separate universe (the
 * Build 25 authorization's own explicit instruction). Health/risk are
 * pure display (computed live server-side, passed down); ownership/
 * management-attention/renewals/expansions are the genuinely mutable
 * pieces, each its own small client component.
 */
export function ClientSuccessHealthTab({
  companyId,
  health,
  churnRisk,
  csProfile,
  assignableUsers,
  renewals,
  eligibleContracts,
  expansions,
  dealsForHandoff,
  canManage,
}: {
  companyId: string;
  health: CustomerHealthResult;
  churnRisk: ChurnRiskResult;
  csProfile: CrmClientSuccessProfile | null;
  assignableUsers: User[];
  renewals: CrmClientSuccessRenewalWithRelations[];
  eligibleContracts: { id: string; contractNumber: string; endDate: Date | null }[];
  expansions: CrmClientSuccessExpansionWithRelations[];
  dealsForHandoff: { id: string; title: string }[];
  canManage: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5">
          <HeartPulse className="size-4 text-muted-foreground" aria-hidden="true" />
          <SectionHeader
            title="Health"
            description={health.overallScore !== null ? `Health: ${health.overallScore} / 100 — Coverage: ${health.coverage.measurable} of ${health.coverage.total} components measurable.` : `Not measurable — 0 of ${health.coverage.total} components measurable.`}
            className="flex-1"
          />
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={HEALTH_STATUS_TONE[health.overallStatus]}>{HEALTH_STATUS_LABELS[health.overallStatus]}</StatusBadge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {health.components.map((c) => (
            <ComponentCard key={c.key} component={c} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-1.5">
          <ShieldAlert className="size-4 text-muted-foreground" aria-hidden="true" />
          <SectionHeader title="Churn risk" description="A transparent, rule-based classification from currently measurable signals only — not the future Churn & Risk Engine (Roadmap Module 69)." className="flex-1" />
        </div>
        <StatusBadge status={CHURN_RISK_TONE[churnRisk.level]}>{CHURN_RISK_LABELS[churnRisk.level]}</StatusBadge>
        {churnRisk.reasons.length > 0 ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {churnRisk.reasons.map((r) => (
              <li key={r.code} className="flex items-start gap-2">
                <span className="mt-0.5 text-xs font-mono text-muted-foreground">{r.code}</span>
                <span>{r.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{churnRisk.level === "UNKNOWN" ? "No measurable signals yet." : "No risk factors identified."}</p>
        )}
      </section>

      {canManage ? (
        <section className="flex flex-col gap-4">
          <SectionHeader title="Ownership & attention" />
          <ClientSuccessOwnerPanel companyId={companyId} users={assignableUsers} currentOwnerUserId={csProfile?.csOwnerUserId ?? null} attentionFlag={csProfile?.managementAttentionFlag ?? false} attentionReason={csProfile?.managementAttentionReason ?? null} />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <SectionHeader title="Renewals" description="Tracked against real contracts — never a fabricated date." />
        {canManage ? (
          <ClientSuccessRenewals companyId={companyId} renewals={renewals} eligibleContracts={eligibleContracts} />
        ) : (
          <RenewalsReadOnly renewals={renewals} />
        )}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Expansion opportunities" description="Client-Success-identified growth signals — not a second Sales Pipeline." />
        {canManage ? <ClientSuccessExpansions companyId={companyId} expansions={expansions} dealsForHandoff={dealsForHandoff} /> : <ExpansionsReadOnly expansions={expansions} />}
      </section>
    </div>
  );
}

function ComponentCard({ component }: { component: HealthComponent }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{component.label}</span>
          <StatusBadge status={HEALTH_STATUS_TONE[component.status]}>
            {HEALTH_STATUS_LABELS[component.status]}
            {component.score !== null ? ` — ${component.score}` : ""}
          </StatusBadge>
        </div>
        <p className="text-xs text-muted-foreground">{component.reason}</p>
      </CardContent>
    </Card>
  );
}

function RenewalsReadOnly({ renewals }: { renewals: CrmClientSuccessRenewalWithRelations[] }) {
  if (renewals.length === 0) return <p className="text-sm text-muted-foreground">No renewals tracked.</p>;
  return (
    <div className="flex flex-col gap-2">
      {renewals.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex items-center justify-between gap-3">
            <span className="text-sm">{r.contract.contractNumber}</span>
            <StatusBadge status={r.status === "RENEWED" ? "success" : r.status === "NOT_RENEWING" || r.status === "EXPIRED" ? "destructive" : "neutral"}>{r.status.replace("_", " ")}</StatusBadge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ExpansionsReadOnly({ expansions }: { expansions: CrmClientSuccessExpansionWithRelations[] }) {
  if (expansions.length === 0) return <p className="text-sm text-muted-foreground">No expansion opportunities.</p>;
  return (
    <div className="flex flex-col gap-2">
      {expansions.map((e) => (
        <Card key={e.id}>
          <CardContent className="flex items-center justify-between gap-3">
            <span className="text-sm">{e.title}</span>
            <StatusBadge status={e.status === "HANDED_TO_SALES" ? "success" : e.status === "DISMISSED" ? "destructive" : "neutral"}>{e.status.replace(/_/g, " ")}</StatusBadge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
