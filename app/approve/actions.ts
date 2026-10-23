"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import {
  createApproveDocument,
  deleteApproveDocument,
  renameApproveDocument,
  setApproveFields,
  signApproveDocument,
  submitApproveDocument,
} from "@/lib/actions/approve"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs, plus a refresh of /approve.

async function attempt<T>(run: () => Promise<T>) {
  try {
    const result = await run()
    revalidatePath("/approve", "layout")
    return { result }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

const actor = () => requireActor("/approve")

export const createDocument = async (input: unknown) =>
  attempt(async () => runAction(createApproveDocument, await actor(), input))
export const renameDocument = async (input: unknown) =>
  attempt(async () => runAction(renameApproveDocument, await actor(), input))
export const saveFields = async (input: unknown) =>
  attempt(async () => runAction(setApproveFields, await actor(), input))
export const submitDocument = async (id: string) =>
  attempt(async () => runAction(submitApproveDocument, await actor(), { id }))
export const signDocument = async (input: unknown) =>
  attempt(async () => runAction(signApproveDocument, await actor(), input))
export const deleteDocument = async (id: string) =>
  attempt(async () => runAction(deleteApproveDocument, await actor(), { id }))
