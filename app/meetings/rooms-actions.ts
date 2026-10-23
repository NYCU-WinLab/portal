"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import {
  bookMeeting,
  cancelMeeting,
  getEpicDeliverables,
  listGroupEpics,
  listRoomAvailability,
} from "@/lib/actions/rooms"
import {
  deleteStandingMeeting,
  setStandingMeetingActive,
} from "@/lib/actions/rooms-series"
import { requireActor } from "@/lib/auth/session"

// The page's reads and writes: the same actions MCP runs.

async function attempt<T>(path: string, run: () => Promise<T>) {
  try {
    const result = await run()
    revalidatePath(path)
    return { result }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export async function loadAvailability(date: string, days: number) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () =>
    runAction(listRoomAvailability, actor, { date, days, merge: false })
  )
}

export async function loadEpics(group: string) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () => runAction(listGroupEpics, actor, { group }))
}

export async function loadDeliverables(group: string, epic: string) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () =>
    runAction(getEpicDeliverables, actor, { group, epic })
  )
}

export async function bookMeetingAction(input: unknown) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () => runAction(bookMeeting, actor, input))
}

export async function cancelMeetingAction(id: string) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () => runAction(cancelMeeting, actor, { id }))
}

export async function setSeriesActiveAction(id: string, active: boolean) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () =>
    runAction(setStandingMeetingActive, actor, { id, active })
  )
}

export async function deleteSeriesAction(id: string) {
  const actor = await requireActor("/meetings")
  return attempt("/meetings", () =>
    runAction(deleteStandingMeeting, actor, { id })
  )
}
