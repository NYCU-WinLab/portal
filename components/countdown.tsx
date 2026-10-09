"use client"

import * as React from "react"

import { NumberTicker } from "@/components/ui/number-ticker"

const MINUTE = 60 * 1000
const TICK = 15 * 1000

// The clock, read every 15 seconds; null on the server, so the first client
// render matches it and nothing ticks until mounted.
function subscribe(update: () => void) {
  const timer = setInterval(update, TICK)
  return () => clearInterval(timer)
}
const readClock = () => Math.floor(Date.now() / TICK) * TICK
const serverClock = () => null

function parts(ms: number) {
  const minutes = Math.max(0, Math.ceil(ms / MINUTE))
  return {
    days: Math.floor(minutes / 1440),
    hours: Math.floor((minutes % 1440) / 60),
    minutes: minutes % 60,
  }
}

// Time left until a moment, to the minute: "3 天 19 小時 37 分". Units that
// are zero at the front drop out; the digits roll as the minutes pass. Once
// the moment arrives it shows children instead (for example "進行中").
function Countdown({
  to,
  children = "現在",
}: {
  /** The moment, as an ISO string with its offset or a Date. */
  to: string | Date
  children?: React.ReactNode
}) {
  const target = new Date(to).getTime()
  const now = React.useSyncExternalStore(subscribe, readClock, serverClock)

  const left = target - (now ?? target - 1)
  if (now !== null && left <= 0) return <>{children}</>
  const { days, hours, minutes } = parts(left)
  const units = [
    { value: days, unit: "天", show: days > 0 },
    { value: hours, unit: "小時", show: days > 0 || hours > 0 },
    { value: minutes, unit: "分", show: true },
  ].filter((part) => part.show)

  return (
    <span data-slot="countdown" className="inline-flex flex-wrap gap-x-2">
      {now === null ? (
        <span className="invisible">0 分</span>
      ) : (
        units.map((part) => (
          <span key={part.unit} className="inline-flex gap-1">
            <NumberTicker value={part.value} />
            {part.unit}
          </span>
        ))
      )}
    </span>
  )
}

export { Countdown }
