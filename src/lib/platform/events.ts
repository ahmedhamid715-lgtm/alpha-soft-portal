import "server-only";
import { logger } from "@/lib/logging";

/**
 * Domain event conventions (spec section 24). No real business events
 * exist yet (`CustomerCreated`, `ProjectOverdue`, `InvoicePaid`, ...) —
 * those belong to the modules that own those entities. Module 01
 * establishes naming, payload, and handler conventions so every later
 * module emits events the same way instead of inventing its own pattern:
 *
 *   - Event names are `PascalCase`, past tense: `CustomerCreated`, not
 *     `CreateCustomer` or `customer_created`.
 *   - Payloads carry IDs and the minimal data handlers need to decide
 *     whether to act — not full entity dumps. A handler that needs more
 *     should look it up.
 *   - Handlers are idempotent where feasible, since the eventual real bus
 *     (Module 38 workflow triggers build on this) will have at-least-once
 *     delivery semantics once it's backed by something durable.
 *
 * The in-process `EventBus` below is synchronous and non-durable — same
 * caveat as `lib/platform/jobs.ts`'s inline queue. It's enough for Module
 * 01 to prove the shape works; Module 38 (Workflow Automation Engine) and
 * Module 40 (Event System) build the durable version.
 */
export interface DomainEvent<Name extends string = string, Payload = unknown> {
  name: Name;
  payload: Payload;
  occurredAt: Date;
}

export type EventHandler<Payload> = (event: DomainEvent<string, Payload>) => Promise<void>;

export interface EventBus {
  on<Payload>(eventName: string, handler: EventHandler<Payload>): void;
  emit<Payload>(eventName: string, payload: Payload): Promise<void>;
}

class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<string, EventHandler<unknown>[]>();

  on<Payload>(eventName: string, handler: EventHandler<Payload>): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as EventHandler<unknown>);
    this.handlers.set(eventName, list);
  }

  async emit<Payload>(eventName: string, payload: Payload): Promise<void> {
    const event: DomainEvent<string, Payload> = { name: eventName, payload, occurredAt: new Date() };
    const handlers = this.handlers.get(eventName) ?? [];

    const results = await Promise.allSettled(handlers.map((handler) => handler(event)));
    for (const result of results) {
      if (result.status === "rejected") {
        // No retry — a durable bus (Module 40) is what actually needs
        // retry semantics; failing loudly in logs is enough for Module 01.
        logger.error("Event handler threw.", {
          operation: "events.emit",
          eventName,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }
}

export const events: EventBus = new InProcessEventBus();
