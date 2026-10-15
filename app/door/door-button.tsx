"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { DoorClosedIcon, DoorOpenIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { openDoorAction } from "./actions"

type Phase = "idle" | "opening" | "opened"

// How long "已開門" stays before the button is ready again.
const OPENED_MS = 2000

// The launch opens the door once per document, however often the button
// mounts again (going back to /door/go inside the app is not a launch).
let launchHandled = false

// Only the installed home-screen app opens on its own. In a browser tab,
// /door/go is a link anyone can send or redirect to, so it waits for a press
// like /door.
const isHomeScreenApp = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true

export function DoorButton({
  configured,
  online,
  autoOpen,
}: {
  configured: boolean
  online: boolean
  /** /door/go: open on launch and whenever the app comes back to the front. */
  autoOpen: boolean
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [reachable, setReachable] = useState(online)
  const idle = useRef(true)

  const open = useCallback(async () => {
    if (!idle.current) return
    idle.current = false
    setPhase("opening")
    const { error } = await openDoorAction()
    if (error) {
      toast.error(error)
      setReachable(false)
      setPhase("idle")
      idle.current = true
      return
    }
    setReachable(true)
    setPhase("opened")
    setTimeout(() => {
      setPhase("idle")
      idle.current = true
    }, OPENED_MS)
  }, [])

  // A home-screen launch is a fresh navigation. A reload, a back/forward
  // restore or a prerender is the browser re-running the page on its own,
  // and a door must never open because of that; an unknown type counts as no.
  useEffect(() => {
    if (!autoOpen || !configured || launchHandled || !isHomeScreenApp()) return
    const [entry] = performance.getEntriesByType(
      "navigation"
    ) as PerformanceNavigationTiming[]
    if (entry?.type !== "navigate") return
    const timer = setTimeout(() => {
      if (launchHandled) return
      launchHandled = true
      void open()
    }, 0)
    return () => clearTimeout(timer)
  }, [autoOpen, configured, open])

  // Tapping the icon of an app iOS still holds in memory mounts nothing; the
  // page just comes back to the front. That is the same request, so it opens
  // too, once at a time.
  useEffect(() => {
    if (!autoOpen || !configured || !isHomeScreenApp()) return
    const onVisible = () => {
      if (document.visibilityState === "visible") void open()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [autoOpen, configured, open])

  const status = !configured
    ? "門禁沒有設定"
    : phase === "opened"
      ? "已開門"
      : phase === "opening"
        ? "開門中"
        : reachable
          ? "按一下開門"
          : "門禁沒有回應，可以再按一次"

  return (
    <div className="flex flex-col items-center gap-6">
      <Button
        aria-label="開門"
        disabled={!configured || phase === "opening"}
        onClick={() => void open()}
        className="size-40 rounded-full [&_svg]:size-16"
      >
        {phase === "opening" ? (
          <LoaderCircleIcon className="animate-spin" />
        ) : phase === "opened" ? (
          <DoorOpenIcon />
        ) : (
          <DoorClosedIcon />
        )}
      </Button>
      <p role="status" className="text-muted-foreground">
        {status}
      </p>
    </div>
  )
}
