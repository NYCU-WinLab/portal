"use server"

import { revalidatePath } from "next/cache"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  addReimburseEgress,
  addReimburseIngress,
  deleteReimburseEgress,
  deleteReimburseIngress,
  updateReimburseEgress,
  updateReimburseIngress,
} from "@/lib/actions/reimburse"
import { requireActor } from "@/lib/auth/session"

// The pages' writes: the same actions MCP runs, then a refresh of the
// reimburse pages. Input is parsed by the action, as for MCP.

async function call(action: Action, input: unknown) {
  const actor = await requireActor("/reimburse")
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: errorMessage(error) }
  }
  revalidatePath("/reimburse", "layout")
  return {}
}

export const addEgress = async (input: unknown) =>
  call(addReimburseEgress, input)
export const updateEgress = async (input: unknown) =>
  call(updateReimburseEgress, input)
export const deleteEgress = async (entryId: string) =>
  call(deleteReimburseEgress, { entryId })
export const addIngress = async (input: unknown) =>
  call(addReimburseIngress, input)
export const updateIngress = async (input: unknown) =>
  call(updateReimburseIngress, input)
export const deleteIngress = async (entryId: string) =>
  call(deleteReimburseIngress, { entryId })
