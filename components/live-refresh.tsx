"use client"

import { useRouter } from "next/navigation"
import * as React from "react"

// Keeps the page current: when anyone changes data, /api/events says so and
// the page fetches itself again (router.refresh also drops prefetched pages,
// so the next click is fresh too). Bursts of changes refresh once.
// topic null: every change but a long job's progress; else only the
// progress of that job.
function useRefreshOn(topic: string | null) {
  const router = useRouter()
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let opened = false
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => router.refresh(), 300)
    }
    const source = new EventSource("/api/events")
    source.onmessage = (event) => {
      const message = String(event.data)
      if (
        topic === null
          ? !message.startsWith("progress:")
          : message === `progress:${topic}`
      )
        refresh()
    }
    // After a dropped connection (sleep, network change) changes may have
    // been missed, so catch up once it is back.
    source.onopen = () => {
      if (opened) refresh()
      opened = true
    }
    return () => {
      clearTimeout(timer)
      source.close()
    }
  }, [router, topic])
}

/** Refreshes on every change, but not on a long job's progress. */
export function LiveRefresh() {
  useRefreshOn(null)
  return null
}

/** Refreshes on the progress of one long job (announceProgress topic). */
export function ProgressRefresh({ topic }: { topic: string }) {
  useRefreshOn(topic)
  return null
}
