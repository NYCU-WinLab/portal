"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  createDoorSoundRule,
  deleteDoorSoundRule,
  updateDoorSoundRule,
} from "@/lib/actions/door-sound-rules"
import { requireActor } from "@/lib/auth/session"

// The schedule's writes: the same actions MCP runs, then a refresh.

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/door/sounds")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/door/sounds")
  return {}
}

export const create = async (input: unknown) => call(createDoorSoundRule, input)
export const update = async (input: unknown) => call(updateDoorSoundRule, input)
export const remove = async (id: string) => call(deleteDoorSoundRule, { id })
