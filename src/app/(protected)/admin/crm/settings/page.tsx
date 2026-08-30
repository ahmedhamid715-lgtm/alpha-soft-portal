import type { Metadata } from "next";
import { ShieldAlert, Tag, ListPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { resolvePlatformContext } from "@/lib/authorization/context";
import { listLeadSources } from "@/server/services/crm-lead-source-service";
import { listCustomFieldDefinitions } from "@/server/services/crm-custom-field-service";
import { NewLeadSourceForm } from "./new-lead-source-form";
import { LeadSourceToggle } from "./lead-source-toggle";
import { NewCustomFieldForm } from "./new-custom-field-form";
import { CustomFieldToggle } from "./custom-field-toggle";

export const metadata: Metadata = { title: "CRM Settings" };

/** CRM lead sources + custom field definitions — `crm.manage` only, the same "settings-style CRUD, not separately audited" scope `crm-lead-source-service.ts`/`crm-custom-field-service.ts` document. */
export default async function CrmSettingsPage() {
  const context = await resolvePlatformContext();

  if (!context.permissions.has("crm.manage")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="CRM Settings" breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Settings" }]} />
        <EmptyState icon={ShieldAlert} title="You don't have access to this page" description="This requires the crm.manage permission." />
      </div>
    );
  }

  const [sources, leadFields, companyFields, contactFields] = await Promise.all([
    listLeadSources(),
    listCustomFieldDefinitions({ entityType: "LEAD" }),
    listCustomFieldDefinitions({ entityType: "COMPANY" }),
    listCustomFieldDefinitions({ entityType: "CONTACT" }),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="CRM Settings" description="Lead sources and custom fields, scoped to Alpha Page Rankers' own CRM — not the platform-wide custom fields or task engine." breadcrumbs={[{ label: "CRM", href: "/admin/crm" }, { label: "Settings" }]} />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Lead sources" description="Where a lead came from — referral, outbound, website, etc." />
        <Card className="max-w-xl">
          <CardContent>
            <NewLeadSourceForm />
          </CardContent>
        </Card>
        {sources.length === 0 ? (
          <EmptyState icon={Tag} title="No lead sources yet" />
        ) : (
          <div className="flex flex-col gap-2">
            {sources.map((source) => (
              <Card key={source.id}>
                <CardContent className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium">{source.name}</span>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={source.isActive ? "success" : "neutral"}>{source.isActive ? "Active" : "Inactive"}</StatusBadge>
                    <LeadSourceToggle leadSourceId={source.id} isActive={source.isActive} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {(
        [
          { entityType: "LEAD" as const, label: "Lead custom fields", fields: leadFields },
          { entityType: "COMPANY" as const, label: "Company custom fields", fields: companyFields },
          { entityType: "CONTACT" as const, label: "Contact custom fields", fields: contactFields },
        ]
      ).map(({ entityType, label, fields }) => (
        <section key={entityType} className="flex flex-col gap-4">
          <SectionHeader title={label} />
          <Card className="max-w-2xl">
            <CardContent>
              <NewCustomFieldForm entityType={entityType} />
            </CardContent>
          </Card>
          {fields.length === 0 ? (
            <EmptyState icon={ListPlus} title="No custom fields yet" />
          ) : (
            <div className="flex flex-col gap-2">
              {fields.map((field) => (
                <Card key={field.id}>
                  <CardContent className="flex items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{field.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {field.key} · {field.fieldType}
                      </span>
                      {field.fieldType === "SELECT" && Array.isArray(field.options) ? (
                        <div className="flex flex-wrap gap-1.5">
                          {field.options
                            .filter((o): o is string => typeof o === "string")
                            .map((option) => (
                              <span key={option} className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {option}
                              </span>
                            ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={field.isActive ? "success" : "neutral"}>{field.isActive ? "Active" : "Inactive"}</StatusBadge>
                      <CustomFieldToggle definitionId={field.id} isActive={field.isActive} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
