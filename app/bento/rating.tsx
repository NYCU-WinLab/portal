"use client"

import * as React from "react"
import { StarIcon } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import { rateDish } from "./actions"

/** A dish's average stars beside its price; nothing until someone rates it. */
export function DishRating({
  rating,
  ratings,
}: {
  rating: number | null
  ratings: number
}) {
  if (rating === null || ratings === 0) return null
  return (
    <span
      className="flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums"
      aria-label={`${ratings} 人評分，平均 ${rating} 顆星`}
      title={`${ratings} 人評分`}
    >
      <StarIcon aria-hidden className="size-3.5 fill-current" />
      {rating.toFixed(1)}
    </span>
  )
}

/** Five stars the member taps to rate a dish they ordered. */
export function RateDish({
  menuItemId,
  name,
  score,
}: {
  menuItemId: string
  name: string
  score: number | null
}) {
  // Shows the tapped stars at once; falls back to the saved score when the
  // save fails, and to the refreshed score when it succeeds.
  const [shown, setShown] = React.useOptimistic(score)
  const [, startTransition] = React.useTransition()

  function rate(next: number) {
    startTransition(async () => {
      setShown(next)
      const { error } = await rateDish(menuItemId, next)
      if (error) toast.error(error)
    })
  }

  return (
    <span
      className="flex shrink-0 items-center"
      role="group"
      aria-label={`評 ${name}`}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} 顆星`}
          aria-pressed={shown === n}
          onClick={() => rate(n)}
          className="flex h-10 w-7 items-center justify-center text-muted-foreground transition-colors duration-state outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <StarIcon
            aria-hidden
            className={cn(
              "size-4",
              shown !== null && n <= shown && "fill-current text-foreground"
            )}
          />
        </button>
      ))}
    </span>
  )
}
