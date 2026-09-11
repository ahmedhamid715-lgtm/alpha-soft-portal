"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as engagementService from "@/server/services/seo-engagement-service";
import * as measurementService from "@/server/services/seo-measurement-service";

/**
 * Server actions for `/admin/seo` (Build 30 — Roadmap Module 24). Thin
 * wrappers only — every mutation goes through the real domain service,
 * same `ActionResult`/`run()` shape `admin/services/actions.ts` already
 * establishes.
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

async function run<T>(fn: () => Promise<T>, paths: string[] = ["/admin/seo"]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Engagement ---

export async function createSeoEngagementAction(input: unknown) {
  return run(() => engagementService.createSeoEngagement(input), ["/admin/seo", "/admin/services"]);
}

// --- Properties ---

export async function createSeoPropertyAction(input: unknown) {
  return run(() => engagementService.createSeoProperty(input));
}

export async function archiveSeoPropertyAction(input: unknown) {
  return run(() => engagementService.archiveSeoProperty(input));
}

export async function reactivateSeoPropertyAction(input: unknown) {
  return run(() => engagementService.reactivateSeoProperty(input));
}

// --- Keywords ---

export async function createSeoKeywordAction(input: unknown) {
  return run(() => engagementService.createSeoKeyword(input));
}

export async function archiveSeoKeywordAction(input: unknown) {
  return run(() => engagementService.archiveSeoKeyword(input));
}

export async function reactivateSeoKeywordAction(input: unknown) {
  return run(() => engagementService.reactivateSeoKeyword(input));
}

export async function listSeoKeywordsAction(input: unknown) {
  return run(() => engagementService.listSeoKeywords(input));
}

// --- Measurements ---

export async function recordRankObservationAction(input: unknown) {
  return run(() => measurementService.recordRankObservation(input));
}

export async function importRankObservationsAction(input: unknown) {
  return run(() => measurementService.importRankObservations(input));
}

export async function recordSeoAuditRunAction(input: unknown) {
  return run(() => measurementService.recordSeoAuditRun(input));
}

export async function createSeoIssueManuallyAction(input: unknown) {
  return run(() => measurementService.createSeoIssueManually(input));
}

export async function listSeoIssuesAction(input: unknown) {
  return run(() => measurementService.listSeoIssues(input));
}

export async function listSeoAuditRunsAction(input: unknown) {
  return run(() => measurementService.listSeoAuditRuns(input));
}

// --- Issue lifecycle ---

export async function acknowledgeSeoIssueAction(input: unknown) {
  return run(() => measurementService.acknowledgeSeoIssue(input));
}

export async function resolveSeoIssueAction(input: unknown) {
  return run(() => measurementService.resolveSeoIssue(input));
}

export async function ignoreSeoIssueAction(input: unknown) {
  return run(() => measurementService.ignoreSeoIssue(input));
}

export async function reopenSeoIssueAction(input: unknown) {
  return run(() => measurementService.reopenSeoIssue(input));
}

export async function linkSeoIssueToTaskAction(input: unknown) {
  return run(() => measurementService.linkSeoIssueToTask(input), ["/admin/seo", "/admin/tasks"]);
}
