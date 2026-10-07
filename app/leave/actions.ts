"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import { createLeave, deleteLeave } from "@/lib/actions/leave"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs, plus a refresh of /leave.

export async function createLeaveAction(input: {
  date: string
  reason: string
}): Promise<{ error?: string }> {
  const actor = await requireActor("/leave")
  try {
    await runAction(createLeave, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/leave")
  return {}
}

export async function deleteLeaveAction(
  date: string
): Promise<{ error?: string }> {
  const actor = await requireActor("/leave")
  try {
    await runAction(deleteLeave, actor, { date })
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/leave")
  return {}
}
