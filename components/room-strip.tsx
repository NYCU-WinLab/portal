"use client"

import * as React from "react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type Slot, tierOf, type Tier } from "@/lib/rooms/availability"
import { DAY_END_HOUR, DAY_START_HOUR, clock } from "@/lib/rooms/time"
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
// On a phone a cell is too narrow to press, so the strip only previews the
// day: pressing it opens the day as a list of slots.
function RoomStrip({
  label,
  slots,
  onPick,
}: {
  label: string
  slots: Slot[]
  onPick: (index: number) => void
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-4 text-left sm:hidden"
      >
        <span className="w-24 shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
          {label}
        </span>
        <span className="flex h-8 flex-1 overflow-hidden rounded-control border border-border">
          {slots.map((slot) => (
            <span
              key={slot.start}
              className={cn(
                "flex-1 border-r border-background last:border-r-0",
                tierClass[tierOf(slot)]
              )}
            />
          ))}
        </span>
      </button>
      {open && (
        <div className="flex flex-col sm:hidden">
          {slots.map((slot, index) => {
            const tier = tierOf(slot)
            return (
              <button
                key={slot.start}
                type="button"
                onClick={() => onPick(index)}
                className="flex h-11 items-center gap-4 rounded-control px-2 text-left transition-colors duration-state hover:bg-muted"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-3 shrink-0 rounded-full",
                    tierClass[tier]
                  )}
                />
                <span className="tabular-nums">{slot.start}</span>
                <span className="text-muted-foreground">{tierNames[tier]}</span>
              </button>
            )
          })}
        </div>
      )}
      <div className="hidden items-center gap-4 sm:flex">
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
    </div>
  )
}

/** The hours under the strips, lined up with the cells: the label column
 * is w-24 plus the gap-4 beside it. */
function RoomStripAxis() {
  const middle = (DAY_START_HOUR + DAY_END_HOUR) / 2
  return (
    <div className="flex justify-between pl-28 text-muted-foreground tabular-nums">
      {[DAY_START_HOUR, middle, DAY_END_HOUR].map((hour) => (
        <span key={hour}>{clock(hour * 60)}</span>
      ))}
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

export { RoomStrip, RoomStripAxis, RoomStripLegend }
