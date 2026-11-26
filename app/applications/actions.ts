"use server"

import { revalidatePath } from "next/cache"
import type { z } from "zod"

import {
  acceptLabApplication,
  rejectLabApplication,
  requestLabApplicationChanges,
  resendLabApplicationPasswordMail,
  retryLabApplicationProvisioning,
  setApplicationMailGroup,
  setApplicationNotifiee,
  setApplySiteUrl,
  updateLabApplication,
} from "@/lib/actions/applications"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { refusalText } from "@/lib/applications/review-display"
import { requireActor } from "@/lib/auth/session"

const REVIEW = "/applications"
const SETTINGS = "/applications/settings"

// Returns { error } in Chinese instead of throwing, so a dialog stays open
// with the input kept; an application refusal (a stale version, a taken
// username) is put in the processor's words.
async function attempt<I extends z.ZodObject, O>(
  path: string,
  action: Action<I, O>,
  input: unknown
): Promise<{ error?: string }> {
  const actor = await requireActor(path)
  try {
    await runAction(action, actor, input)
  } catch (error) {
    return { error: refusalText(error) ?? errorMessage(error) }
  }
  revalidatePath(path)
  return {}
}

export const updateApplication = async (input: unknown) =>
  attempt(REVIEW, updateLabApplication, input)
export const requestChanges = async (input: unknown) =>
  attempt(REVIEW, requestLabApplicationChanges, input)
export const acceptApplication = async (input: unknown) =>
  attempt(REVIEW, acceptLabApplication, input)
export const retryProvisioning = async (input: unknown) =>
  attempt(REVIEW, retryLabApplicationProvisioning, input)
export const rejectApplication = async (input: unknown) =>
  attempt(REVIEW, rejectLabApplication, input)
export const resendPasswordMail = async (input: unknown) =>
  attempt(REVIEW, resendLabApplicationPasswordMail, input)
export const setNotifiee = async (input: unknown) =>
  attempt(SETTINGS, setApplicationNotifiee, input)
export const setMailGroup = async (input: unknown) =>
  attempt(SETTINGS, setApplicationMailGroup, input)
export const saveApplySiteUrl = async (input: unknown) =>
  attempt(SETTINGS, setApplySiteUrl, input)
