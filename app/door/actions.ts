"use server"

import { errorMessage, runAction } from "@/lib/actions/define"
import { openDoor } from "@/lib/actions/door"
import { requireActor } from "@/lib/auth/session"

// The button's one write: the same action MCP runs. The relay's token stays
// on the server.
export async function openDoorAction(): Promise<{ error?: string }> {
  const actor = await requireActor("/door")
  try {
    await runAction(openDoor, actor, {})
  } catch (error) {
    return { error: errorMessage(error) }
  }
  return {}
}
