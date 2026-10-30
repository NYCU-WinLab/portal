"use server"

import type { z } from "zod"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  addPlaylist,
  addSong,
  getLyrics,
  likeSong,
  playNext,
  removeSong,
  searchMusic,
  setAutoplay,
  setPaused,
  setVolume,
  skipSong,
  unlikeSong,
} from "@/lib/actions/music"
import { requireActor } from "@/lib/auth/session"

// Every page's writes, one wrapper each. A failure comes back as { error }
// for a toast; success returns the action's result. Open pages refresh
// through LiveRefresh, so nothing here revalidates.
async function call<Input extends z.ZodObject, Output>(
  action: Action<Input, Output>,
  input: unknown
): Promise<
  { data: Output; error?: undefined } | { error: string; data?: undefined }
> {
  const actor = await requireActor("/music")
  try {
    return { data: await runAction(action, actor, input) }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export const search = async (input: unknown) => call(searchMusic, input)
export const add = async (input: unknown) => call(addSong, input)
export const addList = async (input: unknown) => call(addPlaylist, input)
export const next = async (input: unknown) => call(playNext, input)
export const skip = async (input: unknown) => call(skipSong, input)
export const remove = async (input: unknown) => call(removeSong, input)
export const pause = async (input: unknown) => call(setPaused, input)
export const volume = async (input: unknown) => call(setVolume, input)
export const autoplay = async (input: unknown) => call(setAutoplay, input)
export const lyrics = async (input: unknown) => call(getLyrics, input)
export const like = async (input: unknown) => call(likeSong, input)
export const unlike = async (input: unknown) => call(unlikeSong, input)
