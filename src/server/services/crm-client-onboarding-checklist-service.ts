import "server-only";
import { z } from "zod";
import { generateId } from "@/lib/utils/id";
import { parseOrThrow } from "@/lib/validation/parse";
import { withTenantContext } from "@/lib/tenancy/context";
import { resolveCrmScope, assertPlatformStaffMember } from "./crm-shared";
import { lockActiveOnboarding } from "./crm-client-onboarding-service";
import { crmClientOnboardingRepository } from "@/server/repositories/crm-client-onboarding-repository";
import { crmClientOnboardingRequirementRepository } from "@/server/repositories/crm-client-onboarding-requirement-repository";
import { crmClientOnboardingChecklistItemRepository } from "@/server/repositories/crm-client-onboarding-checklist-item-repository";
import { crmClientOnboardingDocumentRepository } from "@/server/repositories/crm-client-onboarding-document-repository";
import { crmClientOnboardingIntakeFieldRepository } from "@/server/repositories/crm-client-onboarding-intake-field-repository";
import { crmClientOnboardingIntakeResponseRepository } from "@/server/repositories/crm-client-onboarding-intake-response-repository";
import { crmClientOnboardingAssignmentRepository } from "@/server/repositories/crm-client-onboarding-assignment-repository";
import { evaluateCompletionCriteria, isReadyForKickoff } from "@/lib/crm/onboarding-progress";
import { events } from "@/lib/platform/events";
import { audit } from "@/lib/audit/service";
import { NotFoundError, ValidationError, ConflictError } from "@/lib/errors/app-error";
import type { CrmClientOnboardingRequirement, CrmClientOnboardingChecklistItem, CrmClientOnboardingDocument } from "@/generated/prisma/client";
import type { TransactionClient } from "@/lib/db/transaction";

/**
 * Onboarding requirements/checklist/documents (Build 23) — onboarding-
 * scoped only, never global Task Management or Document Management (see
 * each model's own schema comment). Completion is idempotent/race-safe
 * (CAS `updateMany()` at the repository layer); after ANY completion,
 * this module checks whether the onboarding just became "ready for
 * kickoff" and fires the one notification for that transition — never a
 * notification per individual item completion (no notification spam).
 */

async function auditItem(
  actorContext: Parameters<typeof audit.recordSuccess>[0]["knownActor"],
  action: "crm.onboarding.requirement_completed" | "crm.onboarding.checklist_item_completed" | "crm.onboarding.kickoff_scheduled",
  organizationId: string,
  resourceType: string,
  resourceId: string,
  resourceName: string,
): Promise<void> {
  await audit.recordSuccess({ action, organizationId, resourceType, resourceId, resourceName, knownActor: actorContext }).catch((error) => console.error(`[audit] failed to record ${action}`, error));
}

/**
 * Re-evaluates completion criteria after an item completes and fires the
 * ready-for-kickoff notification exactly once, at the moment the
 * transition actually happens (never repeatedly, never on every item).
 * Exported so `crm-client-onboarding-intake-service.ts`'s own
 * `recordIntakeResponse()` can call it too (Codex Security Engineer
 * finding #8 — intake was the one completion-criteria input that never
 * triggered this check, so an onboarding whose LAST unmet gate was an
 * intake field never actually notified anyone that it became ready).
 *
 * Recipients are resolved from the onboarding's own actual assignments
 * (`ONBOARDING_OWNER`/`ACCOUNT_MANAGER`/`SERVICE_LEAD`), not from a
 * blanket "everyone who holds `crm.onboarding.manage`" query (Codex
 * Security Engineer finding #9 — the prior behavior could notify staff
 * with no actual connection to this onboarding, and would miss the
 * point of a per-onboarding assignment model entirely). Falls back to
 * nothing if this onboarding genuinely has no assignees yet — never
 * silently widens back out to every permission-holder.
 *
 * Returns the notification payload rather than emitting it directly —
 * every call site is inside a transaction that also holds this
 * onboarding's own row lock (`lockActiveOnboarding()`), and emitting from
 * inside that critical section (Codex Performance Engineer review) both
 * extends how long the lock is held for no reason and risks a "phantom"
 * notification if the transaction's own commit fails after the emit.
 * Callers emit AFTER their transaction commits, the same
 * "notify-after-commit" discipline `notifyOnboardingCompleted()` already
 * establishes for the completion path.
 */
export type ReadyForKickoffNotification = { onboardingId: string; organizationId: string; recipientUserIds: string[]; companyName: string };

export async function checkReadyForKickoff(onboardingId: string, organizationId: string, tx: TransactionClient): Promise<ReadyForKickoffNotification | null> {
  const onboarding = await crmClientOnboardingRepository.findById(onboardingId, tx);
  if (!onboarding || onboarding.kickoffScheduledAt) return null;
  const [intakeFields, intakeResponses, requirements, checklistItems] = await Promise.all([
    crmClientOnboardingIntakeFieldRepository.listForOrganization(organizationId, "ACTIVE", tx),
    crmClientOnboardingIntakeResponseRepository.listForOnboarding(onboardingId, tx),
    crmClientOnboardingRequirementRepository.listForOnboarding(onboardingId, tx),
    crmClientOnboardingChecklistItemRepository.listForOnboarding(onboardingId, tx),
  ]);
  const criteria = evaluateCompletionCriteria({ intakeFields, intakeResponses, requirements, checklistItems, kickoffScheduledAt: onboarding.kickoffScheduledAt, kickoffCompletedAt: onboarding.kickoffCompletedAt });
  if (!isReadyForKickoff(criteria, onboarding.kickoffScheduledAt)) return null;

  const [onboardingWithRelations, assignments] = await Promise.all([crmClientOnboardingRepository.findByIdWithRelations(onboardingId, tx), crmClientOnboardingAssignmentRepository.listForOnboarding(onboardingId, tx)]);
  if (!onboardingWithRelations) return null;
  const recipientUserIds = [...new Set(assignments.map((a) => a.userId))];
  if (recipientUserIds.length === 0) return null;
  return { onboardingId, organizationId, recipientUserIds, companyName: onboardingWithRelations.company.name };
}

/** Emits the notification `checkReadyForKickoff()` reported — a no-op if it returned `null`. Call this AFTER the transaction that called `checkReadyForKickoff()` has committed. */
export async function emitReadyForKickoffIfAny(notification: ReadyForKickoffNotification | null): Promise<void> {
  if (!notification) return;
  await events.emit<ReadyForKickoffNotification>("crm.onboarding.ready_for_kickoff", notification);
}

// --- Requirements ---

const createRequirementSchema = z.object({
  onboardingId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  required: z.boolean().default(true),
  responsibleUserId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function createRequirement(rawInput: unknown): Promise<CrmClientOnboardingRequirement> {
  const input = parseOrThrow(createRequirementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  const requirement = await withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    if (input.responsibleUserId) await assertPlatformStaffMember(input.responsibleUserId, organizationId, tx);
    const existingCount = await crmClientOnboardingRequirementRepository.countForOnboarding(input.onboardingId, tx);
    return crmClientOnboardingRequirementRepository.create(
      { id: generateId(), organizationId, onboardingId: input.onboardingId, title: input.title, description: input.description ?? null, required: input.required, responsibleUserId: input.responsibleUserId ?? null, dueDate: input.dueDate ?? null, sortOrder: existingCount },
      tx,
    );
  });

  if (input.responsibleUserId) {
    const onboarding = await withTenantContext(tenantScope, (tx) => crmClientOnboardingRepository.findByIdWithRelations(input.onboardingId, tx));
    if (onboarding) {
      await events.emit<{ onboardingId: string; organizationId: string; recipientUserId: string; companyName: string; requirementTitle: string }>("crm.onboarding.requirement_assigned", {
        onboardingId: input.onboardingId,
        organizationId,
        recipientUserId: input.responsibleUserId,
        companyName: onboarding.company.name,
        requirementTitle: requirement.title,
      });
    }
  }
  void context;
  return requirement;
}

const listRequirementsSchema = z.object({ onboardingId: z.string().uuid() });

export async function listRequirements(rawInput: unknown): Promise<CrmClientOnboardingRequirement[]> {
  const input = parseOrThrow(listRequirementsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  return withTenantContext(tenantScope, async (tx) => {
    const onboarding = await crmClientOnboardingRepository.findById(input.onboardingId, tx);
    if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");
    return crmClientOnboardingRequirementRepository.listForOnboarding(input.onboardingId, tx);
  });
}

const completeRequirementSchema = z.object({ requirementId: z.string().uuid() });

export async function completeRequirement(rawInput: unknown): Promise<CrmClientOnboardingRequirement> {
  const input = parseOrThrow(completeRequirementSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  let readyForKickoff: ReadyForKickoffNotification | null = null;
  const requirement = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingRequirementRepository.findById(input.requirementId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Requirement");
    await lockActiveOnboarding(existing.onboardingId, organizationId, tx);
    const updated = await crmClientOnboardingRequirementRepository.complete(input.requirementId, tx);
    if (!updated) throw new ConflictError("This requirement was already completed.");
    readyForKickoff = await checkReadyForKickoff(existing.onboardingId, organizationId, tx);
    return updated;
  });

  await auditItem(context.user ? { userId: context.user.id, displayName: context.user.name } : undefined, "crm.onboarding.requirement_completed", organizationId, "crm_client_onboarding_requirement", requirement.id, requirement.title);
  await emitReadyForKickoffIfAny(readyForKickoff);
  return requirement;
}

const linkRequirementDocumentSchema = z.object({ requirementId: z.string().uuid(), documentId: z.string().uuid().nullable() });

export async function linkRequirementDocument(rawInput: unknown): Promise<CrmClientOnboardingRequirement> {
  const input = parseOrThrow(linkRequirementDocumentSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingRequirementRepository.findById(input.requirementId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Requirement");
    await lockActiveOnboarding(existing.onboardingId, organizationId, tx);
    if (input.documentId) {
      const document = await crmClientOnboardingDocumentRepository.findById(input.documentId, tx);
      if (!document || document.organizationId !== organizationId || document.onboardingId !== existing.onboardingId) {
        throw new ValidationError("documentId must reference a document belonging to this same onboarding.");
      }
    }
    return crmClientOnboardingRequirementRepository.update(input.requirementId, { documentId: input.documentId }, tx);
  });
}

// --- Checklist ---

const createChecklistItemSchema = z.object({
  onboardingId: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  required: z.boolean().default(true),
  assignedToUserId: z.string().uuid().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export async function createChecklistItem(rawInput: unknown): Promise<CrmClientOnboardingChecklistItem> {
  const input = parseOrThrow(createChecklistItemSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  return withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    if (input.assignedToUserId) await assertPlatformStaffMember(input.assignedToUserId, organizationId, tx);
    const existingCount = await crmClientOnboardingChecklistItemRepository.countForOnboarding(input.onboardingId, tx);
    return crmClientOnboardingChecklistItemRepository.create(
      { id: generateId(), organizationId, onboardingId: input.onboardingId, title: input.title, description: input.description ?? null, required: input.required, assignedToUserId: input.assignedToUserId ?? null, dueDate: input.dueDate ?? null, sortOrder: existingCount },
      tx,
    );
  });
}

const listChecklistItemsSchema = z.object({ onboardingId: z.string().uuid() });

export async function listChecklistItems(rawInput: unknown): Promise<CrmClientOnboardingChecklistItem[]> {
  const input = parseOrThrow(listChecklistItemsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  return withTenantContext(tenantScope, async (tx) => {
    const onboarding = await crmClientOnboardingRepository.findById(input.onboardingId, tx);
    if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");
    return crmClientOnboardingChecklistItemRepository.listForOnboarding(input.onboardingId, tx);
  });
}

const completeChecklistItemSchema = z.object({ checklistItemId: z.string().uuid() });

export async function completeChecklistItem(rawInput: unknown): Promise<CrmClientOnboardingChecklistItem> {
  const input = parseOrThrow(completeChecklistItemSchema, rawInput);
  const { context, tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");

  let readyForKickoff: ReadyForKickoffNotification | null = null;
  const item = await withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingChecklistItemRepository.findById(input.checklistItemId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Checklist item");
    await lockActiveOnboarding(existing.onboardingId, organizationId, tx);
    const updated = await crmClientOnboardingChecklistItemRepository.complete(input.checklistItemId, tx);
    if (!updated) throw new ConflictError("This checklist item was already completed.");
    readyForKickoff = await checkReadyForKickoff(existing.onboardingId, organizationId, tx);
    return updated;
  });

  await auditItem(context.user ? { userId: context.user.id, displayName: context.user.name } : undefined, "crm.onboarding.checklist_item_completed", organizationId, "crm_client_onboarding_checklist_item", item.id, item.title);
  await emitReadyForKickoffIfAny(readyForKickoff);
  return item;
}

const reopenChecklistItemSchema = z.object({ checklistItemId: z.string().uuid() });

export async function reopenChecklistItem(rawInput: unknown): Promise<CrmClientOnboardingChecklistItem> {
  const input = parseOrThrow(reopenChecklistItemSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingChecklistItemRepository.findById(input.checklistItemId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Checklist item");
    await lockActiveOnboarding(existing.onboardingId, organizationId, tx);
    return crmClientOnboardingChecklistItemRepository.reopen(input.checklistItemId, tx);
  });
}

// --- Documents (metadata-only references — see the model's own schema comment; no real upload) ---

const createDocumentSchema = z.object({ onboardingId: z.string().uuid(), title: z.string().min(1).max(200), description: z.string().max(2000).nullable().optional() });

export async function createDocumentRequest(rawInput: unknown): Promise<CrmClientOnboardingDocument> {
  const input = parseOrThrow(createDocumentSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");
  return withTenantContext(tenantScope, async (tx) => {
    await lockActiveOnboarding(input.onboardingId, organizationId, tx);
    return crmClientOnboardingDocumentRepository.create({ id: generateId(), organizationId, onboardingId: input.onboardingId, title: input.title, description: input.description ?? null }, tx);
  });
}

const listDocumentsSchema = z.object({ onboardingId: z.string().uuid() });

export async function listDocuments(rawInput: unknown): Promise<CrmClientOnboardingDocument[]> {
  const input = parseOrThrow(listDocumentsSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.read");
  return withTenantContext(tenantScope, async (tx) => {
    const onboarding = await crmClientOnboardingRepository.findById(input.onboardingId, tx);
    if (!onboarding || onboarding.organizationId !== organizationId) throw new NotFoundError("Onboarding");
    return crmClientOnboardingDocumentRepository.listForOnboarding(input.onboardingId, tx);
  });
}

const markDocumentReceivedSchema = z.object({ documentId: z.string().uuid(), receivedNote: z.string().max(2000).nullable().optional() });

/** Records that a document was actually received, with an honest free-text note on how — never a real upload (see the repository's own comment). */
export async function markDocumentReceived(rawInput: unknown): Promise<CrmClientOnboardingDocument> {
  const input = parseOrThrow(markDocumentReceivedSchema, rawInput);
  const { tenantScope, organizationId } = await resolveCrmScope("crm.onboarding.manage");
  return withTenantContext(tenantScope, async (tx) => {
    const existing = await crmClientOnboardingDocumentRepository.findById(input.documentId, tx);
    if (!existing || existing.organizationId !== organizationId) throw new NotFoundError("Document");
    await lockActiveOnboarding(existing.onboardingId, organizationId, tx);
    const updated = await crmClientOnboardingDocumentRepository.markReceived(input.documentId, input.receivedNote ?? null, tx);
    if (!updated) throw new ConflictError("This document was already marked received.");
    return updated;
  });
}
