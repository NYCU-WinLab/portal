"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import { deleteIpUser, saveIpUser } from "@/lib/actions/ip-users"
import { requireActor } from "@/lib/auth/session"

async function attempt(run: () => Promise<unknown>) {
  try {
    await run()
    revalidatePath("/admins/ip-users")
    return {}
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export const save = async (input: unknown) =>
  attempt(async () =>
    runAction(saveIpUser, await requireActor("/admins/ip-users"), input)
  )
export const remove = async (input: unknown) =>
  attempt(async () =>
    runAction(deleteIpUser, await requireActor("/admins/ip-users"), input)
  )
