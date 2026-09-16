"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as engagementService from "@/server/services/ecommerce-engagement-service";
import * as catalogService from "@/server/services/ecommerce-catalog-service";
import * as launchService from "@/server/services/ecommerce-launch-service";

/**
 * Server actions for `/admin/ecommerce` (Build 33 — Roadmap Module 27).
 * Thin wrappers only — every mutation goes through the real domain
 * service, same `ActionResult`/`run()` shape `admin/websites/actions.ts`
 * already establishes.
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

async function run<T>(fn: () => Promise<T>, paths: string[] = ["/admin/ecommerce"]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Engagement ---

export async function createEcommerceEngagementAction(input: unknown) {
  return run(() => engagementService.createEcommerceEngagement(input), ["/admin/ecommerce", "/admin/services"]);
}

export async function createAndLinkEcommerceProjectAction(input: unknown) {
  return run(() => engagementService.createAndLinkEcommerceProject(input), ["/admin/ecommerce", "/admin/projects"]);
}

export async function linkExistingEcommerceProjectAction(input: unknown) {
  return run(() => engagementService.linkExistingEcommerceProject(input), ["/admin/ecommerce", "/admin/projects"]);
}

// --- Stores ---

export async function createEcommerceStoreAction(input: unknown) {
  return run(() => engagementService.createEcommerceStore(input));
}

export async function updateEcommerceStoreAction(input: unknown) {
  return run(() => engagementService.updateEcommerceStore(input));
}

export async function updateEcommerceStoreConfigurationAction(input: unknown) {
  return run(() => engagementService.updateEcommerceStoreConfiguration(input));
}

export async function archiveEcommerceStoreAction(input: unknown) {
  return run(() => engagementService.archiveEcommerceStore(input));
}

export async function reactivateEcommerceStoreAction(input: unknown) {
  return run(() => engagementService.reactivateEcommerceStore(input));
}

// --- Catalog: products / variants / collections ---

export async function createEcommerceProductAction(input: unknown) {
  return run(() => catalogService.createEcommerceProduct(input));
}

export async function transitionEcommerceProductStatusAction(input: unknown) {
  return run(() => catalogService.transitionEcommerceProductStatus(input));
}

export async function createEcommerceVariantAction(input: unknown) {
  return run(() => catalogService.createEcommerceVariant(input));
}

export async function listEcommerceVariantsAction(input: unknown) {
  return run(() => catalogService.listEcommerceVariants(input));
}

export async function createEcommerceCollectionAction(input: unknown) {
  return run(() => catalogService.createEcommerceCollection(input));
}

export async function addEcommerceProductToCollectionAction(input: unknown) {
  return run(() => catalogService.addEcommerceProductToCollection(input));
}

export async function importEcommerceProductCsvAction(input: unknown) {
  return run(() => catalogService.importEcommerceProductCsv(input));
}

// --- Launch ---

export async function recordEcommerceStoreLaunchAction(input: unknown) {
  return run(() => launchService.recordEcommerceStoreLaunch(input), ["/admin/ecommerce", "/admin/crm"]);
}
