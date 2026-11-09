"use client"

import { HeartIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

import { like, unlike } from "./actions"
import { ok } from "./ok"

/** The member's heart on a song: filled when they liked it, tap to flip. It
 * flips at once and falls back if the action fails. */
export function LikeButton({
  videoId,
  liked,
}: {
  videoId: string
  liked: boolean
}) {
  const [shown, setShown] = React.useOptimistic(liked)
  const [, start] = React.useTransition()
  const label = shown ? "取消愛心" : "按愛心"
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={shown}
            onClick={() =>
              start(async () => {
                setShown(!shown)
                ok(await (shown ? unlike : like)({ videoId }))
              })
            }
          />
        }
      >
        <HeartIcon className={shown ? "fill-current" : undefined} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
