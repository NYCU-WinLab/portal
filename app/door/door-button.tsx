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

export function DoorButton({
  configured,
  online,
}: {
  configured: boolean
  online: boolean
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
    // A request that never answers (network down, server error) counts as
    // the door not answering, so the button is ready for another press.
    const { error } = await openDoorAction().catch(() => ({
      error: "門禁沒有回應",
    }))
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
          const pressed = idle.current
          // The door first: the sound must never stand in its way.
          void open()
          if (!pressed) return
          try {
            playUnlockSound()
          } catch {
            // No sound this time (no Web Audio, or too many contexts).
          }
        }}
        className="relative rounded-full outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 enabled:cursor-pointer disabled:opacity-50"
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
