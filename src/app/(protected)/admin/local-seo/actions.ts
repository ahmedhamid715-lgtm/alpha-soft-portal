"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors/app-error";
import * as engagementService from "@/server/services/local-seo-engagement-service";
import * as measurementService from "@/server/services/local-seo-measurement-service";

/**
 * Server actions for `/admin/local-seo` (Build 31 — Roadmap Module 25).
 * Thin wrappers only — every mutation goes through the real domain
 * service, same `ActionResult`/`run()` shape `admin/seo/actions.ts`
 * already establishes.
 */
interface ActionResult<T> {
  data?: T;
  error?: string;
}

async function run<T>(fn: () => Promise<T>, paths: string[] = ["/admin/local-seo"]): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    for (const path of paths) revalidatePath(path);
    return { data };
  } catch (error) {
    return { error: toAppError(error).message };
  }
}

// --- Engagement ---

export async function createLocalSeoEngagementAction(input: unknown) {
  return run(() => engagementService.createLocalSeoEngagement(input), ["/admin/local-seo", "/admin/services"]);
}

// --- Locations ---

export async function createLocalSeoLocationAction(input: unknown) {
  return run(() => engagementService.createLocalSeoLocation(input));
}

export async function updateLocalSeoLocationAction(input: unknown) {
  return run(() => engagementService.updateLocalSeoLocation(input));
}

export async function archiveLocalSeoLocationAction(input: unknown) {
  return run(() => engagementService.archiveLocalSeoLocation(input));
}

export async function reactivateLocalSeoLocationAction(input: unknown) {
  return run(() => engagementService.reactivateLocalSeoLocation(input));
}

// --- GBP profile ---

export async function recordGbpProfileAction(input: unknown) {
  return run(() => engagementService.recordGbpProfile(input));
}

// --- Keywords ---

export async function createLocalSeoKeywordAction(input: unknown) {
  return run(() => engagementService.createLocalSeoKeyword(input));
}

export async function archiveLocalSeoKeywordAction(input: unknown) {
  return run(() => engagementService.archiveLocalSeoKeyword(input));
}

export async function reactivateLocalSeoKeywordAction(input: unknown) {
  return run(() => engagementService.reactivateLocalSeoKeyword(input));
}

export async function listLocalSeoKeywordsAction(input: unknown) {
  return run(() => engagementService.listLocalSeoKeywords(input));
}

// --- Measurements ---

export async function recordLocalRankObservationAction(input: unknown) {
  return run(() => measurementService.recordLocalRankObservation(input));
}

export async function importLocalRankObservationsAction(input: unknown) {
  return run(() => measurementService.importLocalRankObservations(input));
}

// --- Listings ---

export async function recordLocalListingAction(input: unknown) {
  return run(() => measurementService.recordLocalListing(input));
}

export async function listLocalListingsAction(input: unknown) {
  return run(() => measurementService.listLocalListings(input));
}

// --- Reviews ---

export async function recordLocalReviewAction(input: unknown) {
  return run(() => measurementService.recordLocalReview(input));
}

export async function listLocalReviewsAction(input: unknown) {
  return run(() => measurementService.listLocalReviews(input));
}

export async function draftLocalReviewResponseAction(input: unknown) {
  return run(() => measurementService.draftLocalReviewResponse(input));
}

export async function confirmLocalReviewResponseAction(input: unknown) {
  return run(() => measurementService.confirmLocalReviewResponse(input));
}

// --- Audits + issues ---

export async function recordLocalSeoAuditRunAction(input: unknown) {
  return run(() => measurementService.recordLocalSeoAuditRun(input));
}

export async function createLocalSeoIssueManuallyAction(input: unknown) {
  return run(() => measurementService.createLocalSeoIssueManually(input));
}

export async function listLocalSeoIssuesAction(input: unknown) {
  return run(() => measurementService.listLocalSeoIssues(input));
}

export async function listLocalSeoAuditRunsAction(input: unknown) {
  return run(() => measurementService.listLocalSeoAuditRuns(input));
}

// --- Issue lifecycle ---

export async function acknowledgeLocalSeoIssueAction(input: unknown) {
  return run(() => measurementService.acknowledgeLocalSeoIssue(input));
}

export async function resolveLocalSeoIssueAction(input: unknown) {
  return run(() => measurementService.resolveLocalSeoIssue(input));
}

export async function ignoreLocalSeoIssueAction(input: unknown) {
  return run(() => measurementService.ignoreLocalSeoIssue(input));
}

export async function reopenLocalSeoIssueAction(input: unknown) {
  return run(() => measurementService.reopenLocalSeoIssue(input));
}

export async function linkLocalSeoIssueToTaskAction(input: unknown) {
  return run(() => measurementService.linkLocalSeoIssueToTask(input), ["/admin/local-seo", "/admin/tasks"]);
}
