"use server"

import { revalidatePath } from "next/cache"

import {
  rotateCalendarFeeds,
  setCalendarVisibility,
  unlinkGoogleCalendar,
} from "@/lib/actions/calendar"
import {
  bookAppointment,
  setAppointmentSchedule,
} from "@/lib/actions/appointments"
import { errorMessage, runAction } from "@/lib/actions/define"
import { cancelMeeting } from "@/lib/actions/rooms"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs, plus a refresh of /calendar.

async function run(
  write: (actor: Awaited<ReturnType<typeof requireActor>>) => Promise<unknown>
): Promise<{ error?: string }> {
  const actor = await requireActor("/calendar")
  try {
    await write(actor)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/calendar", "layout")
  return {}
}

export const setVisibilityAction = async (visibility: "private" | "public") =>
  run((actor) => runAction(setCalendarVisibility, actor, { visibility }))

export const unlinkAction = async () =>
  run((actor) => runAction(unlinkGoogleCalendar, actor, {}))

export const rotateFeedsAction = async () =>
  run((actor) => runAction(rotateCalendarFeeds, actor, {}))

export const saveScheduleAction = async (
  input: Parameters<typeof setAppointmentSchedule.run>[1]
) => run((actor) => runAction(setAppointmentSchedule, actor, input))

export const cancelAppointmentAction = async (id: string) =>
  run((actor) => runAction(cancelMeeting, actor, { id }))

export const bookAppointmentAction = async (
  input: Omit<Parameters<typeof bookAppointment.run>[1], "allow_paid">
) =>
  run((actor) =>
    runAction(bookAppointment, actor, { ...input, allow_paid: false })
  )
