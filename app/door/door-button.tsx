"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"

import { openDoorAction } from "./actions"
import { LockParticles } from "./lock-particles"
import { playUnlockSound } from "./unlock-sound"

type Phase = "idle" | "opening" | "opened"

// How long "已開門" stays before the button is ready again.
const OPENED_MS = 2000
// While opening the lock flips between these, one every half second.
const OPENING = ["🔒", "🔓"]
const FRAME_MS = 500

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
  const [frame, setFrame] = useState(0)
  // Counts failures, so each one replays the shake.
  const [shakes, setShakes] = useState(0)
  const idle = useRef(true)

  useEffect(() => {
    if (phase !== "opening") return
    const timer = setInterval(() => setFrame((n) => n + 1), FRAME_MS)
    return () => clearInterval(timer)
  }, [phase])

  const open = useCallback(async () => {
    if (!idle.current) return
    idle.current = false
    setFrame(0)
    setPhase("opening")
    const { error } = await openDoorAction()
    if (error) {
      toast.error(error)
      setReachable(false)
      setShakes((n) => n + 1)
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

  const emoji = !configured
    ? "🔧"
    : phase === "opened"
      ? "🏃"
      : phase === "opening"
        ? OPENING[frame % OPENING.length]
        : reachable
          ? "🚪"
          : "🚫"

  return (
    <div className="flex flex-col items-center gap-6">
      <LockParticles active={phase === "opening"} />
      <button
        type="button"
        aria-label="開門"
        disabled={!configured || phase === "opening"}
        // The sound starts inside the tap, the only place iOS allows it.
        onClick={() => {
          if (idle.current) playUnlockSound()
          void open()
        }}
        className="relative rounded-full outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:cursor-pointer"
      >
        <span
          key={reachable ? 0 : shakes}
          className={cn(
            "block text-emoji",
            phase === "opening" && "animate-door-wiggle",
            !reachable && shakes > 0 && "animate-door-shake"
          )}
        >
          {emoji}
        </span>
      </button>
      <p role="status" className="text-muted-foreground">
        {status}
      </p>
    </div>
  )
}
