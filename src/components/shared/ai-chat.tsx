import type { ReactNode } from "react"
import { Bot, Check, Sparkles, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

/**
 * AI conversation primitives (spec: "AI message primitives," "AI action/
 * confirmation UI"). Visual only — no model calls, no streaming, no
 * business logic. Module 33 (AI Core) owns the actual Anthropic
 * integration and wires real data through these components' props.
 */

export interface ChatMessageProps {
  role: "user" | "assistant"
  content: ReactNode
  timestamp?: string
  className?: string
}

export function ChatMessage({ role, content, timestamp, className }: ChatMessageProps) {
  const isAssistant = role === "assistant"
  return (
    <div className={cn("flex gap-3", !isAssistant && "flex-row-reverse", className)}>
      <Avatar className="size-7 shrink-0 border border-border">
        {isAssistant ? (
          <AvatarFallback className="bg-primary/10 text-primary">
            <Bot className="size-3.5" aria-hidden="true" />
          </AvatarFallback>
        ) : (
          <AvatarFallback className="text-xs">YO</AvatarFallback>
        )}
      </Avatar>
      <div className={cn("flex max-w-[80%] flex-col gap-1", !isAssistant && "items-end")}>
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-sm text-pretty",
            isAssistant ? "rounded-tl-sm bg-muted text-foreground" : "rounded-tr-sm bg-primary text-primary-foreground"
          )}
        >
          {content}
        </div>
        {timestamp ? <span className="px-1 text-xs text-muted-foreground">{timestamp}</span> : null}
      </div>
    </div>
  )
}

export function ChatThread({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4", className)}>{children}</div>
}

/** The animated "assistant is composing a response" affordance — respects prefers-reduced-motion globally (see globals.css). */
export function AIThinkingIndicator({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 px-1 text-sm text-muted-foreground", className)}>
      <Sparkles className="size-3.5 animate-pulse text-primary" aria-hidden="true" />
      <span className="sr-only">Assistant is composing a response</span>
      <span className="flex gap-1" aria-hidden="true">
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
        <span className="size-1.5 animate-bounce rounded-full bg-current" />
      </span>
    </div>
  )
}

export interface AIActionCardProps {
  /** e.g. "Create support ticket", "Send email to customer" */
  title: string
  description?: string
  /** Key/value pairs of the proposed action's parameters — shown so the user can verify before approving. */
  details?: { label: string; value: string }[]
  onApprove: () => void
  onDeny: () => void
  loading?: boolean
  className?: string
}

/**
 * The "AI wants to do X — approve?" card. Every state-changing action an
 * AI agent proposes should render through something like this rather
 * than executing silently — visual/interaction pattern only here; the
 * actual tool-confirmation wiring is Module 33/35 (AI Tool System).
 */
export function AIActionCard({ title, description, details, onApprove, onDeny, loading, className }: AIActionCardProps) {
  return (
    <Card className={cn("border-primary/30 bg-primary/5 gap-3", className)}>
      <CardHeader className="flex-row items-start gap-2.5 space-y-0">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">{title}</p>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </CardHeader>
      {details?.length ? (
        <CardContent className="flex flex-col gap-1.5 rounded-lg bg-card px-3 py-2.5 text-sm">
          {details.map((item) => (
            <div key={item.label} className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-medium">{item.value}</span>
            </div>
          ))}
        </CardContent>
      ) : null}
      <CardContent className="flex items-center gap-2">
        <Button size="sm" onClick={onApprove} disabled={loading}>
          <Check className="size-3.5" aria-hidden="true" />
          Approve
        </Button>
        <Button size="sm" variant="outline" onClick={onDeny} disabled={loading}>
          <X className="size-3.5" aria-hidden="true" />
          Deny
        </Button>
      </CardContent>
    </Card>
  )
}
