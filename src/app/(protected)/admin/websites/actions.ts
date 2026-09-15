"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as engagementService from "@/server/services/website-engagement-service";
import * as deploymentService from "@/server/services/website-deployment-service";

/**
 * Server actions for `/admin/websites` (Build 32 — Roadmap Module 26).
 * Thin wrappers only — every mutation goes through the real domain
 * service, same `ActionResult`/`run()` shape `admin/local-seo/actions.ts`
 * already establishes.
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

async function run<T>(fn: () => Promise<T>, paths: string[] = ["/admin/websites"]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Engagement ---

export async function createWebsiteEngagementAction(input: unknown) {
  return run(() => engagementService.createWebsiteEngagement(input), ["/admin/websites", "/admin/services"]);
}

export async function createAndLinkWebsiteProjectAction(input: unknown) {
  return run(() => engagementService.createAndLinkWebsiteProject(input), ["/admin/websites", "/admin/projects"]);
}

export async function linkExistingWebsiteProjectAction(input: unknown) {
  return run(() => engagementService.linkExistingWebsiteProject(input), ["/admin/websites", "/admin/projects"]);
}

// --- Sites ---

export async function createWebsiteSiteAction(input: unknown) {
  return run(() => engagementService.createWebsiteSite(input));
}

export async function updateWebsiteSiteAction(input: unknown) {
  return run(() => engagementService.updateWebsiteSite(input));
}

export async function archiveWebsiteSiteAction(input: unknown) {
  return run(() => engagementService.archiveWebsiteSite(input));
}

export async function reactivateWebsiteSiteAction(input: unknown) {
  return run(() => engagementService.reactivateWebsiteSite(input));
}

// --- Environments ---

export async function recordWebsiteEnvironmentAction(input: unknown) {
  return run(() => engagementService.recordWebsiteEnvironment(input));
}

export async function listWebsiteEnvironmentsAction(input: unknown) {
  return run(() => engagementService.listWebsiteEnvironments(input));
}

// --- Pages ---

export async function createWebsitePageAction(input: unknown) {
  return run(() => engagementService.createWebsitePage(input));
}

export async function listWebsitePagesAction(input: unknown) {
  return run(() => engagementService.listWebsitePages(input));
}

export async function transitionWebsitePageStatusAction(input: unknown) {
  return run(() => engagementService.transitionWebsitePageStatus(input));
}

// --- Deployments / launch ---

export async function recordWebsiteDeploymentAction(input: unknown) {
  return run(() => deploymentService.recordWebsiteDeployment(input));
}

export async function listWebsiteDeploymentsAction(input: unknown) {
  return run(() => deploymentService.listWebsiteDeployments(input));
}

export async function recordWebsiteLaunchAction(input: unknown) {
  return run(() => deploymentService.recordWebsiteLaunch(input), ["/admin/websites", "/admin/crm"]);
}
