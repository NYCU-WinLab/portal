"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { setMySignature, setSignatureSettings } from "@/lib/actions/signature"
import { requireActor } from "@/lib/auth/session"

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/profile")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/profile")
  return {}
}

export const saveSignature = async (dataUrl: string) =>
  call(setMySignature, { dataUrl })
export const saveSignatureSettings = async (input: unknown) =>
  call(setSignatureSettings, input)
