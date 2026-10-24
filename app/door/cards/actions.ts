"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  addDoorCard,
  compareDoorCards,
  deleteDoorCard,
  importDoorCards,
  updateDoorCard,
} from "@/lib/actions/door-cards"
import { requireActor } from "@/lib/auth/session"

// The card list's writes: the same actions MCP runs, then a refresh. The
// page refreshes on a failure too: a write the reader left unconfirmed
// still marks the card.

async function call<Output>(action: Action, input: unknown) {
  const actor = await requireActor("/door/cards")
  try {
    return { result: (await runAction(action, actor, input)) as Output }
  } catch (error) {
    return { error: errorMessage(error) }
  } finally {
    revalidatePath("/door/cards")
  }
}

export const add = async (input: unknown) => call(addDoorCard, input)
export const update = async (input: unknown) => call(updateDoorCard, input)
export const remove = async (cardId: string) => call(deleteDoorCard, { cardId })
export const compare = async () =>
  call<{ suspect: boolean; missing: string[]; extra: unknown[] }>(
    compareDoorCards,
    {}
  )
export const importCards = async () =>
  call<{ added: number }>(importDoorCards, {})
