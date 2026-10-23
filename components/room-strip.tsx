"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type Slot, tierOf, type Tier } from "@/lib/rooms/availability"
import { cn } from "@/lib/utils"

const tierClass: Record<Tier, string> = {
  lab: "bg-primary/60 hover:bg-primary/80",
  free: "bg-success/60 hover:bg-success/80",
  paid: "bg-warning/50 hover:bg-warning/70",
  full: "bg-muted hover:bg-muted-foreground/30",
}

export const tierNames: Record<Tier, string> = {
  lab: "實驗室已借",
  free: "有免費教室",
  paid: "只剩付費教室",
  full: "已滿",
}

// One day of department rooms as a strip of 30-minute cells, colored by
// the best thing each cell offers. Pressing a cell starts a booking there.
function RoomStrip({
  label,
  slots,
  onPick,
}: {
  label: string
  slots: Slot[]
  onPick: (index: number) => void
}) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-24 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
        {label}
      </span>
      <div className="flex h-8 flex-1 overflow-hidden rounded-control border border-border">
        {slots.map((slot, index) => {
          const tier = tierOf(slot)
          const lines = [
            ["免費", slot.freeRooms],
            ["付費", slot.paidRooms],
            ["實驗室", slot.labRooms],
          ] as const
          return (
            <Tooltip key={slot.start}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`${label} ${slot.start} ${tierNames[tier]}`}
                    onClick={() => onPick(index)}
                    className={cn(
                      "flex-1 border-r border-background transition-colors duration-state last:border-r-0",
                      tierClass[tier]
                    )}
                  />
                }
              />
              <TooltipContent>
                <p className="tabular-nums">
                  {slot.start} 到 {slot.end}
                </p>
                {tier === "full" ? (
                  <p>已滿</p>
                ) : (
                  lines
                    .filter(([, rooms]) => rooms.length)
                    .map(([name, rooms]) => (
                      <p key={name}>
                        {name}：{rooms.join("、")}
                      </p>
                    ))
                )}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

/** What each color means, once above the strips. */
function RoomStripLegend() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground">
      {(Object.keys(tierNames) as Tier[]).map((tier) => (
        <span key={tier} className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("size-3 rounded-full", tierClass[tier])}
          />
          {tierNames[tier]}
        </span>
      ))}
    </div>
  )
}

export { RoomStrip, RoomStripLegend }
