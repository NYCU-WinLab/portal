"use client"

import { useEffect, useRef } from "react"

const SPAWN_MS = 70
const LOCKS = ["🔒", "🔓"]

// While the door opens, 🔒 and 🔓 shoot up from the button and fall away.
// Each one flies its own arc through the Web Animations API; the ones in the
// air finish their fall after opening ends.
// Skipped when the member asked for reduced motion.
export function LockParticles({ active }: { active: boolean }) {
  const layer = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = layer.current
    if (!active || !host) return
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const spawner = setInterval(() => {
      const lock = document.createElement("span")
      lock.textContent = LOCKS[Math.floor(Math.random() * LOCKS.length)]
      lock.className = "absolute top-1/2 left-1/2 leading-none"
      // Each lock its own size, drawn at that size so the emoji stays sharp.
      lock.style.fontSize = `${22 + Math.random() * 26}px`
      const dx = (Math.random() * 2 - 1) * 280
      const up = -(160 + Math.random() * 240)
      const spin = (Math.random() * 2 - 1) * 180
      const duration = 1200 + Math.random() * 500
      lock.animate(
        [
          { transform: `translate(-50%, -50%)`, opacity: 1 },
          {
            transform: `translate(calc(-50% + ${dx * 0.35}px), calc(-50% + ${up}px)) rotate(${spin}deg)`,
            offset: 0.35,
            easing: "cubic-bezier(0.4, 0, 1, 1)",
          },
          {
            transform: `translate(calc(-50% + ${dx}px), 70vh) rotate(${spin * 2}deg)`,
            opacity: 0,
          },
        ],
        { duration, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "forwards" }
      ).onfinish = () => lock.remove()
      host.append(lock)
    }, SPAWN_MS)
    return () => clearInterval(spawner)
  }, [active])

  return (
    <div
      ref={layer}
      aria-hidden
      className="pointer-events-none fixed inset-0 overflow-hidden"
    />
  )
}
