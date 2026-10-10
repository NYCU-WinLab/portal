"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  deleteReceipt,
  updateReceipt,
  uploadReceipt,
} from "@/lib/actions/receipts"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs, then a refresh of
// /receipts. Input is parsed by the action, as for MCP.

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/receipts")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/receipts")
  return {}
}

export const upload = async (input: unknown) => call(uploadReceipt, input)
export const edit = async (input: unknown) => call(updateReceipt, input)
export const remove = async (id: string) => call(deleteReceipt, { id })
