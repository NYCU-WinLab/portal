"use server"

import { revalidatePath } from "next/cache"

import { removeMyAvatar, setMyAvatar } from "@/lib/actions/avatars"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { setDoorSpeakName, setDoorSuffix } from "@/lib/actions/door-greetings"
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

export const saveDoorSuffix = async (suffix: string) =>
  call(setDoorSuffix, { suffix })

export const saveDoorSpeakName = async (speak: boolean) =>
  call(setDoorSpeakName, { speak })

export const saveAvatar = async (base64: string) =>
  call(setMyAvatar, { base64 })
export const removeAvatar = async () => call(removeMyAvatar, {})
