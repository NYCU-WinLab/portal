"use server"

import { revalidatePath } from "next/cache"

import { createApiKey, revokeApiKey } from "@/lib/actions/api-keys"
import { errorMessage, runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs (creation is page only),
// plus a refresh of /api-keys.

export async function createApiKeyAction(input: {
  name: string
  apps: string[]
}): Promise<{ error?: string; token?: string }> {
  const actor = await requireActor("/api-keys")
  try {
    const { token } = await runAction(createApiKey, actor, input)
    revalidatePath("/api-keys")
    return { token }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export async function revokeApiKeyAction(
  id: string
): Promise<{ error?: string }> {
  const actor = await requireActor("/api-keys")
  try {
    await runAction(revokeApiKey, actor, { id })
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/api-keys")
  return {}
}
