"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import { deleteDoorVoiceClip } from "@/lib/actions/door-phrases"
import { requireActor } from "@/lib/auth/session"

// Re-recording a clip: the same action MCP runs, then a refresh.
export async function rerecord(id: string) {
  const actor = await requireActor("/door/voice")
  try {
    await runAction(deleteDoorVoiceClip, actor, { id })
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/door/voice")
  return {}
}
