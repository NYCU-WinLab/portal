"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  deleteDoorSound,
  renameDoorSound,
  setDoorPlaylist,
  setDoorSoundDefault,
  uploadDoorSound,
} from "@/lib/actions/door-sounds"
import { requireActor } from "@/lib/auth/session"

// The pool's writes: the same actions MCP runs, then a refresh of
// /door/sounds and /profile, which shows the playlist.

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/door/sounds")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/door/sounds")
  revalidatePath("/profile")
  return {}
}

export const upload = async (input: unknown) => call(uploadDoorSound, input)
export const rename = async (id: string, label: string) =>
  call(renameDoorSound, { id, label })
export const remove = async (id: string) => call(deleteDoorSound, { id })
export const savePlaylist = async (sound_ids: string[]) =>
  call(setDoorPlaylist, { sound_ids })
export const markDefault = async (id: string, is_default: boolean) =>
  call(setDoorSoundDefault, { id, is_default })
