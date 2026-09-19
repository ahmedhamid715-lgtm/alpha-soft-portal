"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as engagementService from "@/server/services/ghl-engagement-service";
import * as assetService from "@/server/services/ghl-asset-service";
import * as launchService from "@/server/services/ghl-launch-service";

/**
 * Server actions for `/admin/ghl` (Build 34 — Roadmap Module 28).
 * Thin wrappers only — every mutation goes through the real domain
 * service, same `ActionResult`/`run()` shape `admin/ecommerce/actions.ts`
 * already establishes.
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

async function run<T>(fn: () => Promise<T>, paths: string[] = ["/admin/ghl"]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Engagement ---

export async function createGhlEngagementAction(input: unknown) {
  return run(() => engagementService.createGhlEngagement(input), ["/admin/ghl", "/admin/services"]);
}

export async function createAndLinkGhlProjectAction(input: unknown) {
  return run(() => engagementService.createAndLinkGhlProject(input), ["/admin/ghl", "/admin/projects"]);
}

export async function linkExistingGhlProjectAction(input: unknown) {
  return run(() => engagementService.linkExistingGhlProject(input), ["/admin/ghl", "/admin/projects"]);
}

// --- Workspaces ---

export async function createGhlWorkspaceAction(input: unknown) {
  return run(() => engagementService.createGhlWorkspace(input));
}

export async function updateGhlWorkspaceAction(input: unknown) {
  return run(() => engagementService.updateGhlWorkspace(input));
}

export async function archiveGhlWorkspaceAction(input: unknown) {
  return run(() => engagementService.archiveGhlWorkspace(input));
}

export async function reactivateGhlWorkspaceAction(input: unknown) {
  return run(() => engagementService.reactivateGhlWorkspace(input));
}

// --- Assets ---

export async function createGhlAssetAction(input: unknown) {
  return run(() => assetService.createGhlAsset(input));
}

export async function transitionGhlAssetStatusAction(input: unknown) {
  return run(() => assetService.transitionGhlAssetStatus(input));
}

// --- Integration requirements ---

export async function createGhlIntegrationRequirementAction(input: unknown) {
  return run(() => assetService.createGhlIntegrationRequirement(input));
}

export async function updateGhlIntegrationRequirementStatusAction(input: unknown) {
  return run(() => assetService.updateGhlIntegrationRequirementStatus(input));
}

// --- Import ---

export async function importGhlAssetCsvAction(input: unknown) {
  return run(() => assetService.importGhlAssetCsv(input));
}

// --- Go-live / handoff ---

export async function recordGhlGoLiveAction(input: unknown) {
  return run(() => launchService.recordGhlGoLive(input), ["/admin/ghl", "/admin/crm"]);
}

export async function recordGhlHandoffAction(input: unknown) {
  return run(() => launchService.recordGhlHandoff(input), ["/admin/ghl", "/admin/crm"]);
}
