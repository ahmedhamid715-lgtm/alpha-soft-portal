import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface StepperStep {
  id: string
  label: string
  description?: string
}

export interface StepperProps {
  steps: StepperStep[]
  /** Index of the current step, 0-based. Steps before it are complete. */
  currentStep: number
  className?: string
}

/** Multi-step flow progress — client onboarding, proposal creation, checkout. Horizontal on desktop, condensed on mobile. */
export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <ol className={cn("flex flex-col gap-4 sm:flex-row sm:gap-0", className)} aria-label="Progress">
      {steps.map((step, index) => {
        const status = index < currentStep ? "complete" : index === currentStep ? "current" : "upcoming"
        const isLast = index === steps.length - 1

        return (
          <li key={step.id} className={cn("flex flex-1 items-start gap-3 sm:flex-col sm:items-stretch sm:gap-0")}>
            <div className="flex items-center sm:w-full">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  status === "complete" && "border-primary bg-primary text-primary-foreground",
                  status === "current" && "border-primary text-link",
                  status === "upcoming" && "border-border text-muted-foreground"
                )}
                aria-current={status === "current" ? "step" : undefined}
              >
                {status === "complete" ? <Check className="size-3.5" aria-hidden="true" /> : index + 1}
              </span>
              {!isLast ? (
                <span
                  className={cn("hidden h-px flex-1 sm:ml-2 sm:block", status === "complete" ? "bg-primary" : "bg-border")}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className="flex flex-col gap-0.5 pt-0.5 sm:pt-2">
              <span className={cn("text-sm font-medium", status === "upcoming" && "text-muted-foreground")}>{step.label}</span>
              {step.description ? <span className="text-xs text-muted-foreground">{step.description}</span> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
