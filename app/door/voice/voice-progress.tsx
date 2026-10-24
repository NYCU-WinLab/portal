"use client"

import { Progress } from "@/components/ui/progress"

/** How far the voice job is with one text: a bar and step of steps. */
export function VoiceProgress({
  step,
  steps,
}: {
  step: number
  steps: number
}) {
  return (
    <span className="flex w-32 shrink-0 items-center gap-2 text-muted-foreground tabular-nums">
      <Progress
        aria-label="錄製進度"
        value={steps ? Math.min(100, (step / steps) * 100) : 0}
      />
      {step}/{steps}
    </span>
  )
}
