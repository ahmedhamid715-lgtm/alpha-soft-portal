import "server-only";
import type { AiConversation, AiMessage, AiMessageRole } from "@/generated/prisma/client";
import { db } from "@/lib/db/client";
import { withDbErrorTranslation } from "@/lib/db/errors";
import type { TransactionClient } from "@/lib/db/transaction";
import { type CursorPaginationParams, type CursorPaginatedResult, toCursorPaginatedResult } from "@/lib/platform/pagination";

/** Data access for `AiConversation`/`AiMessage` — RLS-protected; every call must run inside `withTenantContext()`. */
export const aiConversationRepository = {
  async create(input: { id: string; organizationId: string; userId: string; title: string | null }, tx: TransactionClient | typeof db = db): Promise<AiConversation> {
    return withDbErrorTranslation(() => tx.aiConversation.create({ data: { id: input.id, organizationId: input.organizationId, userId: input.userId, title: input.title } }));
  },

  async findById(id: string, tx: TransactionClient | typeof db = db): Promise<AiConversation | null> {
    return withDbErrorTranslation(() => tx.aiConversation.findUnique({ where: { id } }));
  },

  async findByIdWithMessages(id: string, tx: TransactionClient | typeof db = db): Promise<(AiConversation & { messages: AiMessage[] }) | null> {
    return withDbErrorTranslation(() => tx.aiConversation.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } }));
  },

  async close(id: string, tx: TransactionClient | typeof db = db): Promise<AiConversation> {
    return withDbErrorTranslation(() => tx.aiConversation.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } }));
  },

  /** Bumps `updatedAt` after a new message — the ordering `listForUser`/`listForOrganization` below sort by (most-recently-active conversation first). */
  async touchUpdatedAt(id: string, tx: TransactionClient | typeof db = db): Promise<void> {
    await withDbErrorTranslation(() => tx.aiConversation.update({ where: { id }, data: { updatedAt: new Date() } }));
  },

  /** This user's own conversations, most-recently-active first — the default view for `ai.use` alone (no `ai.manage`). */
  async listForUser(organizationId: string, userId: string, params: CursorPaginationParams, tx: TransactionClient | typeof db = db): Promise<CursorPaginatedResult<AiConversation>> {
    const rows = await withDbErrorTranslation(() =>
      tx.aiConversation.findMany({
        where: { organizationId, userId },
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },

  /** EVERY conversation in the organization, regardless of owning user — `ai.manage`-gated oversight view. */
  async listForOrganization(organizationId: string, params: CursorPaginationParams, tx: TransactionClient | typeof db = db): Promise<CursorPaginatedResult<AiConversation>> {
    const rows = await withDbErrorTranslation(() =>
      tx.aiConversation.findMany({
        where: { organizationId },
        orderBy: { id: "desc" },
        take: params.limit + 1,
        ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      }),
    );
    return toCursorPaginatedResult(rows, params.limit, (item) => item.id);
  },

  async addMessage(
    input: {
      id: string;
      conversationId: string;
      role: AiMessageRole;
      content: string;
      model?: string | null;
      inputTokens?: number | null;
      outputTokens?: number | null;
      costMinorUnits?: number | null;
      latencyMs?: number | null;
      providerMessageId?: string | null;
    },
    tx: TransactionClient | typeof db = db,
  ): Promise<AiMessage> {
    return withDbErrorTranslation(() =>
      tx.aiMessage.create({
        data: {
          id: input.id,
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          model: input.model ?? null,
          inputTokens: input.inputTokens ?? null,
          outputTokens: input.outputTokens ?? null,
          costMinorUnits: input.costMinorUnits ?? null,
          latencyMs: input.latencyMs ?? null,
          providerMessageId: input.providerMessageId ?? null,
        },
      }),
    );
  },

  /** Most recent `limit` messages, oldest-first — the exact context window `MAX_CONTEXT_MESSAGES` (`system-prompt.ts`) bounds before resending to the provider. */
  async listRecentMessages(conversationId: string, limit: number, tx: TransactionClient | typeof db = db): Promise<AiMessage[]> {
    const rows = await withDbErrorTranslation(() => tx.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: limit }));
    return rows.reverse();
  },

  /**
   * Module 17 platform observability (`ai.observability`) — usage
   * summed PER ORGANIZATION for messages sent within `[period.start,
   * period.end)`. `{platform: true}` scope's application-level `WHERE`
   * is deliberately empty (see `billing-reporting-security.md`'s own
   * "zero-WHERE platform queries remain tenant-isolated" reasoning,
   * reused verbatim here) — RLS alone confines a non-platform caller.
   * Only `ASSISTANT` messages carry usage/cost (a USER message has none
   * to sum).
   */
  async sumUsageByOrganization(
    scope: { organizationId: string } | { platform: true },
    period: { start: Date; end: Date },
    tx: TransactionClient | typeof db = db,
  ): Promise<{ organizationId: string; messageCount: number; inputTokens: number; outputTokens: number; costMinorUnits: number }[]> {
    const rows = await withDbErrorTranslation(() =>
      tx.aiMessage.findMany({
        where: {
          role: "ASSISTANT",
          createdAt: { gte: period.start, lt: period.end },
          conversation: { ...("organizationId" in scope ? { organizationId: scope.organizationId } : {}) },
        },
        select: { inputTokens: true, outputTokens: true, costMinorUnits: true, conversation: { select: { organizationId: true } } },
      }),
    );
    const totals = new Map<string, { messageCount: number; inputTokens: number; outputTokens: number; costMinorUnits: number }>();
    for (const row of rows) {
      const organizationId = row.conversation.organizationId;
      const existing = totals.get(organizationId) ?? { messageCount: 0, inputTokens: 0, outputTokens: 0, costMinorUnits: 0 };
      existing.messageCount += 1;
      existing.inputTokens += row.inputTokens ?? 0;
      existing.outputTokens += row.outputTokens ?? 0;
      existing.costMinorUnits += row.costMinorUnits ?? 0;
      totals.set(organizationId, existing);
    }
    return Array.from(totals.entries()).map(([organizationId, t]) => ({ organizationId, ...t }));
  },
};
