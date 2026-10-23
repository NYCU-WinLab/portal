"use client"

import * as React from "react"
import { PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// One player for the whole page: starting a sound stops the one before.
let current: { audio: HTMLAudioElement; stop: () => void } | null = null

/** A pool sound's url for PlayButton. */
export const soundSrc = (sound: { id: string; version: string }) =>
  `/door/sounds/files/${sound.id}?v=${sound.version}`

export function PlayButton({
  src,
  label,
}: {
  /** The audio's url. A pool sound carries its version, so a browser that
   * kept an old file fetches the replaced one. */
  src: string
  label: string
}) {
  const [playing, setPlaying] = React.useState(false)
  const mine = React.useRef<HTMLAudioElement | null>(null)

  function toggle() {
    if (playing) {
      current?.stop()
      return
    }
    current?.stop()
    const audio = new Audio(src)
    const stop = () => {
      audio.pause()
      setPlaying(false)
      if (current?.audio === audio) current = null
    }
    audio.onended = stop
    audio.onerror = stop
    current = { audio, stop }
    mine.current = audio
    setPlaying(true)
    audio.play().catch(stop)
  }

  // Leaving the page stops this button's sound.
  React.useEffect(
    () => () => {
      if (current && current.audio === mine.current) current.stop()
    },
    []
  )

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={playing ? `停止 ${label}` : `播放 ${label}`}
      aria-pressed={playing}
      onClick={toggle}
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </Button>
  )
}
