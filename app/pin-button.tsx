"use client"

import { StarIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { setHomePinAction } from "./home-actions"

// The star beside a service on the home page. It flips at once and the page
// moves the row when the refresh lands.
export function PinButton({
  service,
  label,
  pinned,
}: {
  service: string
  label: string
  pinned: boolean
}) {
  const [shown, setShown] = React.useOptimistic(pinned)
  const [, startTransition] = React.useTransition()

  function toggle() {
    startTransition(async () => {
      setShown(!pinned)
      const { error } = await setHomePinAction(service, !pinned)
      if (error) toast.error(error)
    })
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={shown ? `取消置頂 ${label}` : `置頂 ${label}`}
      aria-pressed={shown}
      onClick={toggle}
      className="text-muted-foreground"
    >
      <StarIcon className={shown ? "fill-current text-warning" : undefined} />
    </Button>
  )
}
