"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as companyService from "@/server/services/crm-company-service";
import * as contactService from "@/server/services/crm-contact-service";
import * as leadService from "@/server/services/crm-lead-service";
import * as activityService from "@/server/services/crm-activity-service";
import * as taskService from "@/server/services/crm-task-service";
import * as leadSourceService from "@/server/services/crm-lead-source-service";
import * as customFieldService from "@/server/services/crm-custom-field-service";
import * as pipelineService from "@/server/services/crm-pipeline-service";
import * as pipelineStageService from "@/server/services/crm-pipeline-stage-service";
import * as dealService from "@/server/services/crm-deal-service";
import * as salesTeamService from "@/server/services/crm-sales-team-service";
import * as salesGoalService from "@/server/services/crm-sales-goal-service";
import * as proposalService from "@/server/services/crm-proposal-service";
import * as proposalTemplateService from "@/server/services/crm-proposal-template-service";
import * as contractService from "@/server/services/crm-contract-service";
import type {
  CrmCompany,
  CrmContact,
  CrmLead,
  CrmActivity,
  CrmTask,
  CrmLeadSource,
  CrmCustomFieldDefinition,
  CrmCustomFieldValue,
  CrmPipeline,
  CrmPipelineStage,
  CrmDeal,
  CrmDealHistory,
  CrmSalesTeamMember,
  CrmSalesGoal,
  CrmProposal,
  CrmProposalVersion,
  CrmProposalTemplate,
  CrmContract,
} from "@/generated/prisma/client";

/**
 * Every CRM mutation the UI needs, in one shared file (`/admin/crm/*`
 * sub-routes all import from here — same "one `actions.ts` per route
 * tree, not per leaf page" convention `admin/organizations/actions.ts`
 * already establishes for its own `[id]` child route). Each function is
 * a thin `service call -> revalidate -> typed {error}|{data} result`
 * wrapper — no business logic lives here; see the underlying
 * `crm-*-service.ts` for the real authorization/validation/persistence.
 */

interface ActionResult<T> {
  error?: string;
  data?: T;
}

async function run<T>(fn: () => Promise<T>, paths: string[]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Companies ---

export async function createCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  return run(() => companyService.createCompany(input), ["/admin/crm/companies", "/admin/crm"]);
}

export async function updateCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  const result = await run(() => companyService.updateCompany(input), ["/admin/crm/companies"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.id}`);
  return result;
}

export async function archiveCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  const result = await run(() => companyService.archiveCompany(input), ["/admin/crm/companies", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.id}`);
  return result;
}

export async function reactivateCompanyAction(input: unknown): Promise<ActionResult<CrmCompany>> {
  const result = await run(() => companyService.reactivateCompany(input), ["/admin/crm/companies"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.id}`);
  return result;
}

// --- Contacts ---

export async function createContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.createContact(input), ["/admin/crm/contacts", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/companies/${result.data.companyId}`);
  return result;
}

export async function updateContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.updateContact(input), ["/admin/crm/contacts"]);
  if (result.data) revalidatePath(`/admin/crm/contacts/${result.data.id}`);
  return result;
}

export async function archiveContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.archiveContact(input), ["/admin/crm/contacts"]);
  if (result.data) revalidatePath(`/admin/crm/contacts/${result.data.id}`);
  return result;
}

export async function reactivateContactAction(input: unknown): Promise<ActionResult<CrmContact>> {
  const result = await run(() => contactService.reactivateContact(input), ["/admin/crm/contacts"]);
  if (result.data) revalidatePath(`/admin/crm/contacts/${result.data.id}`);
  return result;
}

// --- Leads ---

export async function createLeadAction(input: unknown): Promise<ActionResult<CrmLead>> {
  return run(() => leadService.createLead(input), ["/admin/crm/leads", "/admin/crm"]);
}

export async function updateLeadAction(input: unknown): Promise<ActionResult<CrmLead>> {
  const result = await run(() => leadService.updateLead(input), ["/admin/crm/leads"]);
  if (result.data) revalidatePath(`/admin/crm/leads/${result.data.id}`);
  return result;
}

export async function changeLeadStatusAction(input: unknown): Promise<ActionResult<CrmLead>> {
  const result = await run(() => leadService.changeLeadStatus(input), ["/admin/crm/leads", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/leads/${result.data.id}`);
  return result;
}

// --- Activities ---

export async function logActivityAction(input: unknown): Promise<ActionResult<CrmActivity>> {
  const result = await run(() => activityService.logActivity(input), []);
  if (result.data) {
    if (result.data.leadId) revalidatePath(`/admin/crm/leads/${result.data.leadId}`);
    if (result.data.companyId) revalidatePath(`/admin/crm/companies/${result.data.companyId}`);
    if (result.data.contactId) revalidatePath(`/admin/crm/contacts/${result.data.contactId}`);
  }
  return result;
}

// --- Tasks ---

export async function createTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.createTask(input), ["/admin/crm/tasks", "/admin/crm"]);
}

export async function updateTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.updateTask(input), ["/admin/crm/tasks"]);
}

export async function completeTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.completeTask(input), ["/admin/crm/tasks", "/admin/crm"]);
}

export async function cancelTaskAction(input: unknown): Promise<ActionResult<CrmTask>> {
  return run(() => taskService.cancelTask(input), ["/admin/crm/tasks", "/admin/crm"]);
}

// --- Lead sources ---

export async function createLeadSourceAction(input: unknown): Promise<ActionResult<CrmLeadSource>> {
  return run(() => leadSourceService.createLeadSource(input), ["/admin/crm/settings"]);
}

export async function updateLeadSourceAction(input: unknown): Promise<ActionResult<CrmLeadSource>> {
  return run(() => leadSourceService.updateLeadSource(input), ["/admin/crm/settings"]);
}

// --- Custom fields ---

export async function createCustomFieldDefinitionAction(input: unknown): Promise<ActionResult<CrmCustomFieldDefinition>> {
  return run(() => customFieldService.createCustomFieldDefinition(input), ["/admin/crm/settings"]);
}

export async function updateCustomFieldDefinitionAction(input: unknown): Promise<ActionResult<CrmCustomFieldDefinition>> {
  return run(() => customFieldService.updateCustomFieldDefinition(input), ["/admin/crm/settings"]);
}

export async function setCustomFieldValueAction(input: unknown): Promise<ActionResult<CrmCustomFieldValue>> {
  const result = await run(() => customFieldService.setCustomFieldValue(input), []);
  if (result.data) {
    if (result.data.leadId) revalidatePath(`/admin/crm/leads/${result.data.leadId}`);
    if (result.data.companyId) revalidatePath(`/admin/crm/companies/${result.data.companyId}`);
    if (result.data.contactId) revalidatePath(`/admin/crm/contacts/${result.data.contactId}`);
  }
  return result;
}

// --- Sales Pipeline (Build 20 / Roadmap 14) ---

export async function createPipelineAction(input: unknown): Promise<ActionResult<CrmPipeline>> {
  return run(() => pipelineService.createPipeline(input), ["/admin/crm/pipeline", "/admin/crm/settings", "/admin/crm"]);
}

export async function updatePipelineAction(input: unknown): Promise<ActionResult<CrmPipeline>> {
  return run(() => pipelineService.updatePipeline(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function archivePipelineAction(input: unknown): Promise<ActionResult<CrmPipeline>> {
  return run(() => pipelineService.archivePipeline(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function reactivatePipelineAction(input: unknown): Promise<ActionResult<CrmPipeline>> {
  return run(() => pipelineService.reactivatePipeline(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function createStageAction(input: unknown): Promise<ActionResult<CrmPipelineStage>> {
  return run(() => pipelineStageService.createStage(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function updateStageAction(input: unknown): Promise<ActionResult<CrmPipelineStage>> {
  return run(() => pipelineStageService.updateStage(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function moveStageAction(input: unknown): Promise<ActionResult<CrmPipelineStage>> {
  return run(() => pipelineStageService.moveStage(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function archiveStageAction(input: unknown): Promise<ActionResult<CrmPipelineStage>> {
  return run(() => pipelineStageService.archiveStage(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function reactivateStageAction(input: unknown): Promise<ActionResult<CrmPipelineStage>> {
  return run(() => pipelineStageService.reactivateStage(input), ["/admin/crm/pipeline", "/admin/crm/settings"]);
}

export async function createDealAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  return run(() => dealService.createDeal(input), ["/admin/crm/pipeline", "/admin/crm"]);
}

export async function updateDealAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.updateDeal(input), ["/admin/crm/pipeline"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.id}`);
  return result;
}

export async function moveDealStageAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.moveDealStage(input), ["/admin/crm/pipeline"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.id}`);
  return result;
}

export async function winDealAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.winDeal(input), ["/admin/crm/pipeline", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.id}`);
  return result;
}

export async function loseDealAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.loseDeal(input), ["/admin/crm/pipeline", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.id}`);
  return result;
}

export async function reopenDealAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.reopenDeal(input), ["/admin/crm/pipeline", "/admin/crm"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.id}`);
  return result;
}

export async function changeDealOwnerAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.changeDealOwner(input), ["/admin/crm/pipeline"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.id}`);
  return result;
}

export async function logDealNoteAction(input: unknown): Promise<ActionResult<CrmDealHistory>> {
  const result = await run(() => dealService.logDealNote(input), []);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.dealId}`);
  return result;
}

export async function convertLeadToDealAction(input: unknown): Promise<ActionResult<CrmDeal>> {
  const result = await run(() => dealService.convertLeadToDeal(input), ["/admin/crm/pipeline", "/admin/crm/leads", "/admin/crm"]);
  if (result.data) {
    revalidatePath(`/admin/crm/deals/${result.data.id}`);
    if (result.data.sourceLeadId) revalidatePath(`/admin/crm/leads/${result.data.sourceLeadId}`);
  }
  return result;
}

// --- Sales Team (Build 21 — Roadmap Module 15).

export async function addSalesTeamMemberAction(input: unknown): Promise<ActionResult<CrmSalesTeamMember>> {
  return run(() => salesTeamService.addSalesTeamMember(input), ["/admin/crm/sales-team"]);
}

export async function removeSalesTeamMemberAction(input: unknown): Promise<ActionResult<CrmSalesTeamMember>> {
  const result = await run(() => salesTeamService.removeSalesTeamMember(input), ["/admin/crm/sales-team"]);
  if (result.data) revalidatePath(`/admin/crm/sales-team/${result.data.id}`);
  return result;
}

export async function changeSalesTeamManagerAction(input: unknown): Promise<ActionResult<CrmSalesTeamMember>> {
  const result = await run(() => salesTeamService.changeSalesTeamManager(input), ["/admin/crm/sales-team"]);
  if (result.data) revalidatePath(`/admin/crm/sales-team/${result.data.id}`);
  return result;
}

export async function createSalesGoalAction(input: unknown): Promise<ActionResult<CrmSalesGoal>> {
  const result = await run(() => salesGoalService.createGoal(input), ["/admin/crm/sales-team"]);
  if (result.data?.salesTeamMemberId) revalidatePath(`/admin/crm/sales-team/${result.data.salesTeamMemberId}`);
  return result;
}

export async function archiveSalesGoalAction(input: unknown): Promise<ActionResult<CrmSalesGoal>> {
  const result = await run(() => salesGoalService.archiveGoal(input), ["/admin/crm/sales-team"]);
  if (result.data?.salesTeamMemberId) revalidatePath(`/admin/crm/sales-team/${result.data.salesTeamMemberId}`);
  return result;
}

// --- Proposals & Contracts (Build 22 — Roadmap Module 16). Every mutation
// revalidates the proposal's own detail route plus its originating deal's
// detail route (the "Deal -> Proposals" surface) — mirroring
// `logDealNoteAction`'s own "revalidate the parent too" pattern above.

export async function createProposalAction(input: unknown): Promise<ActionResult<CrmProposal>> {
  const result = await run(() => proposalService.createProposal(input), ["/admin/crm/proposals"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.dealId}`);
  return result;
}

export async function updateProposalDraftAction(input: unknown): Promise<ActionResult<CrmProposalVersion>> {
  const result = await run(() => proposalService.updateProposalDraft(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.proposalId}`);
  return result;
}

export async function reviseProposalAction(input: unknown): Promise<ActionResult<CrmProposalVersion>> {
  const result = await run(() => proposalService.reviseProposal(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.proposalId}`);
  return result;
}

export async function sendProposalAction(input: unknown): Promise<ActionResult<CrmProposal>> {
  const result = await run(() => proposalService.sendProposal(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.id}`);
  return result;
}

export async function submitProposalForApprovalAction(input: unknown): Promise<ActionResult<CrmProposalVersion>> {
  const result = await run(() => proposalService.submitProposalForApproval(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.proposalId}`);
  return result;
}

export async function decideProposalApprovalAction(input: unknown): Promise<ActionResult<CrmProposalVersion>> {
  const result = await run(() => proposalService.decideProposalApproval(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.proposalId}`);
  return result;
}

export async function rejectProposalAction(input: unknown): Promise<ActionResult<CrmProposal>> {
  const result = await run(() => proposalService.rejectProposal(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.id}`);
  return result;
}

export async function expireProposalAction(input: unknown): Promise<ActionResult<CrmProposal>> {
  const result = await run(() => proposalService.expireProposal(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.id}`);
  return result;
}

export async function acceptProposalAction(input: unknown): Promise<ActionResult<CrmProposal>> {
  const result = await run(() => proposalService.acceptProposal(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.id}`);
  return result;
}

export async function assignProposalAction(input: unknown): Promise<ActionResult<CrmProposal>> {
  const result = await run(() => proposalService.assignProposal(input), []);
  if (result.data) revalidatePath(`/admin/crm/proposals/${result.data.id}`);
  return result;
}

// --- Proposal templates ---

export async function createProposalTemplateAction(input: unknown): Promise<ActionResult<CrmProposalTemplate>> {
  return run(() => proposalTemplateService.createProposalTemplate(input), ["/admin/crm/proposals/templates"]);
}

export async function updateProposalTemplateAction(input: unknown): Promise<ActionResult<CrmProposalTemplate>> {
  return run(() => proposalTemplateService.updateProposalTemplate(input), ["/admin/crm/proposals/templates"]);
}

export async function archiveProposalTemplateAction(input: unknown): Promise<ActionResult<CrmProposalTemplate>> {
  return run(() => proposalTemplateService.archiveProposalTemplate(input), ["/admin/crm/proposals/templates"]);
}

export async function reactivateProposalTemplateAction(input: unknown): Promise<ActionResult<CrmProposalTemplate>> {
  return run(() => proposalTemplateService.reactivateProposalTemplate(input), ["/admin/crm/proposals/templates"]);
}

// --- Contracts ---

export async function createContractFromProposalAction(input: unknown): Promise<ActionResult<CrmContract>> {
  const result = await run(() => contractService.createContractFromProposal(input), ["/admin/crm/contracts"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.dealId}`);
  return result;
}

export async function createManualContractAction(input: unknown): Promise<ActionResult<CrmContract>> {
  const result = await run(() => contractService.createManualContract(input), ["/admin/crm/contracts"]);
  if (result.data) revalidatePath(`/admin/crm/deals/${result.data.dealId}`);
  return result;
}

export async function activateContractAction(input: unknown): Promise<ActionResult<CrmContract>> {
  const result = await run(() => contractService.activateContract(input), ["/admin/crm/contracts"]);
  if (result.data) revalidatePath(`/admin/crm/contracts/${result.data.id}`);
  return result;
}

export async function terminateContractAction(input: unknown): Promise<ActionResult<CrmContract>> {
  const result = await run(() => contractService.terminateContract(input), ["/admin/crm/contracts"]);
  if (result.data) revalidatePath(`/admin/crm/contracts/${result.data.id}`);
  return result;
}

export async function cancelContractAction(input: unknown): Promise<ActionResult<CrmContract>> {
  const result = await run(() => contractService.cancelContract(input), ["/admin/crm/contracts"]);
  if (result.data) revalidatePath(`/admin/crm/contracts/${result.data.id}`);
  return result;
}

export async function expireContractAction(input: unknown): Promise<ActionResult<CrmContract>> {
  const result = await run(() => contractService.expireContract(input), ["/admin/crm/contracts"]);
  if (result.data) revalidatePath(`/admin/crm/contracts/${result.data.id}`);
  return result;
}
