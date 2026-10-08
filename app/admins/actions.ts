"use server"

import { revalidatePath } from "next/cache"

import { grantAdmin, revokeAdmin } from "@/lib/actions/admins"
import { errorMessage, runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

type Input = { userId: string; app: string }

export async function grantAdminAction(
  input: Input
): Promise<{ error?: string }> {
  const actor = await requireActor("/admins")
  try {
    await runAction(grantAdmin, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/admins")
  return {}
}

export async function revokeAdminAction(
  input: Input
): Promise<{ error?: string }> {
  const actor = await requireActor("/admins")
  try {
    await runAction(revokeAdmin, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/admins")
  return {}
}
