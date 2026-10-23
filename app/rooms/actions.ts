"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import {
  bookRoom,
  cancelRoomBooking,
  getEpicDeliverables,
  listGroupEpics,
  listRoomAvailability,
} from "@/lib/actions/rooms"
import {
  createRoomSeries,
  deleteRoomSeries,
  setRoomSeriesActive,
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
  const actor = await requireActor("/rooms")
  return attempt("/rooms", () =>
    runAction(listRoomAvailability, actor, { date, days, merge: false })
  )
}

export async function loadEpics(group: string) {
  const actor = await requireActor("/rooms")
  return attempt("/rooms", () => runAction(listGroupEpics, actor, { group }))
}

export async function loadDeliverables(group: string, epic: string) {
  const actor = await requireActor("/rooms")
  return attempt("/rooms", () =>
    runAction(getEpicDeliverables, actor, { group, epic })
  )
}

export async function bookRoomAction(input: unknown) {
  const actor = await requireActor("/rooms")
  return attempt("/rooms", () => runAction(bookRoom, actor, input))
}

export async function cancelBookingAction(id: string) {
  const actor = await requireActor("/rooms")
  return attempt("/rooms", () => runAction(cancelRoomBooking, actor, { id }))
}

export async function createSeriesAction(input: unknown) {
  const actor = await requireActor("/rooms/series")
  return attempt("/rooms/series", () =>
    runAction(createRoomSeries, actor, input)
  )
}

export async function setSeriesActiveAction(id: string, active: boolean) {
  const actor = await requireActor("/rooms/series")
  return attempt("/rooms/series", () =>
    runAction(setRoomSeriesActive, actor, { id, active })
  )
}

export async function deleteSeriesAction(id: string) {
  const actor = await requireActor("/rooms/series")
  return attempt("/rooms/series", () =>
    runAction(deleteRoomSeries, actor, { id })
  )
}
