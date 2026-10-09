"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { updateMyMeeting } from "@/lib/actions/meetings"
import {
  addMeeting,
  deleteMeeting,
  fillPresenters,
  generateSemester,
  setQuestioners,
  swapMeetings,
  updateMeeting,
} from "@/lib/actions/meetings-admin"
import { addPaper, deletePaper, updatePaper } from "@/lib/actions/papers"
import {
  addPresenter,
  movePresenter,
  removePresenter,
} from "@/lib/actions/presenters"
import { requireActor } from "@/lib/auth/session"

// The pages' writes: the same actions MCP runs, then a refresh of the
// meetings pages. Input is parsed by the action, as for MCP.

type Result = { error?: string }

async function call(action: Action, input: unknown): Promise<Result> {
  const actor = await requireActor("/meetings")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/meetings", "layout")
  return {}
}

export const updateMine = async (input: unknown) => call(updateMyMeeting, input)
export const generate = async (input: unknown) => call(generateSemester, input)
export const add = async (input: unknown) => call(addMeeting, input)
export const update = async (input: unknown) => call(updateMeeting, input)
export const remove = async (input: unknown) => call(deleteMeeting, input)
export const swap = async (input: unknown) => call(swapMeetings, input)
export const fill = async () => call(fillPresenters, {})
export const questioners = async (input: unknown) => call(setQuestioners, input)
export const paperAdd = async (input: unknown) => call(addPaper, input)
export const paperUpdate = async (input: unknown) => call(updatePaper, input)
export const paperDelete = async (input: unknown) => call(deletePaper, input)
export const presenterAdd = async (input: unknown) => call(addPresenter, input)
export const presenterRemove = async (input: unknown) =>
  call(removePresenter, input)
export const presenterMove = async (input: unknown) =>
  call(movePresenter, input)
