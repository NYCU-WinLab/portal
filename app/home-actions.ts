"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import { setHomePin } from "@/lib/actions/home"
import { requireActor } from "@/lib/auth/session"

// The home page's one write: the same action MCP runs, plus a refresh of /.

export async function setHomePinAction(
  service: string,
  pinned: boolean
): Promise<{ error?: string }> {
  const actor = await requireActor("/")
  try {
    await runAction(setHomePin, actor, { service, pinned })
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/")
  return {}
}
