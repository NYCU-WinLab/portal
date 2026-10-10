"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  createTrip,
  deleteTrip,
  deleteTripFile,
  updateTrip,
  updateTripFile,
  uploadTripFile,
} from "@/lib/actions/trip"
import { requireActor } from "@/lib/auth/session"

// The pages' writes: the same actions MCP runs, then a refresh of the trip
// pages. Input is parsed by the action, as for MCP.

async function call<T>(action: Action, input: unknown) {
  const actor = await requireActor("/trip")
  let result: T
  try {
    result = (await runAction(action, actor, input)) as T
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/trip", "layout")
  return { result }
}

export const upload = async (input: unknown) => call(uploadTripFile, input)
export const describeFile = async (fileId: string, description: string) =>
  call(updateTripFile, { fileId, description })
export const removeFile = async (fileId: string) =>
  call(deleteTripFile, { fileId })
export const addTrip = async (input: unknown) =>
  call<{ id: string }>(createTrip, input)
export const editTrip = async (input: unknown) => call(updateTrip, input)
export const removeTrip = async (tripId: string) => call(deleteTrip, { tripId })
