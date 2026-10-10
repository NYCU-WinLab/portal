"use server"

import { revalidatePath } from "next/cache"

import {
  createAnnouncement,
  deleteAnnouncement,
  updateAnnouncement,
} from "@/lib/actions/bulletin"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs, then a refresh of the board
// and the home page that shows the newest post.

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/bulletin")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/bulletin")
  revalidatePath("/")
  return {}
}

export const createPost = async (input: unknown) =>
  call(createAnnouncement, input)
export const updatePost = async (input: unknown) =>
  call(updateAnnouncement, input)
export const deletePost = async (id: string) => call(deleteAnnouncement, { id })
