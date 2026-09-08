import type { CrmProposalStatus, CrmContractStatus, CrmProposalApprovalStatus } from "@/generated/prisma/client";

/** Maps each Build 22 lifecycle enum to the shared `StatusBadge` color vocabulary — one place, reused by every list/detail page. */
export function proposalStatusVariant(status: CrmProposalStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "DRAFT":
      return "neutral";
    case "SENT":
      return "info";
    case "ACCEPTED":
      return "success";
    case "REJECTED":
      return "destructive";
    case "EXPIRED":
      return "warning";
  }
}

export function contractStatusVariant(status: CrmContractStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "DRAFT":
      return "neutral";
    case "ACTIVE":
      return "success";
    case "EXPIRED":
      return "warning";
    case "TERMINATED":
    case "CANCELLED":
      return "destructive";
  }
}

export function approvalStatusVariant(status: CrmProposalApprovalStatus): "neutral" | "success" | "warning" | "destructive" | "info" {
  switch (status) {
    case "NOT_REQUIRED":
      return "neutral";
    case "PENDING":
      return "warning";
    case "APPROVED":
      return "success";
    case "REJECTED":
      return "destructive";
  }
}
