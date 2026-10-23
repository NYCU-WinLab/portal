"use client"

import * as React from "react"
import { PauseIcon, PlayIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

// One player for the whole page: starting a sound stops the one before.
let current: { audio: HTMLAudioElement; stop: () => void } | null = null

export function PlayButton({
  soundId,
  label,
}: {
  soundId: string
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
    const audio = new Audio(`/door/sounds/files/${soundId}`)
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
