"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import { createDoorToken, revokeDoorToken } from "@/lib/actions/door-tokens"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs (creation is page only),
// plus a refresh of /door/tokens.

export async function createDoorTokenAction(
  name: string
): Promise<{ error?: string; token?: string }> {
  const actor = await requireActor("/door/tokens")
  try {
    const { token } = await runAction(createDoorToken, actor, { name })
    revalidatePath("/door/tokens")
    return { token }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export async function revokeDoorTokenAction(
  id: string
): Promise<{ error?: string }> {
  const actor = await requireActor("/door/tokens")
  try {
    await runAction(revokeDoorToken, actor, { id })
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/door/tokens")
  return {}
}
