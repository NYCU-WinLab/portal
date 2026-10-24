"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  createDoorPhrase,
  deleteDoorPhrase,
  updateDoorPhrase,
} from "@/lib/actions/door-phrases"
import { requireActor } from "@/lib/auth/session"

// The schedule's writes: the same actions MCP runs, then a refresh.

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/door/greetings")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/door/greetings")
  return {}
}

export const create = async (input: unknown) => call(createDoorPhrase, input)
export const update = async (input: unknown) => call(updateDoorPhrase, input)
export const remove = async (id: string, lab: boolean) =>
  call(deleteDoorPhrase, { id, default: lab })
