"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { errorMessage, runAction } from "@/lib/actions/define"
import {
  authorizeDeveloperApp,
  registerDeveloperApp,
  requestDeveloperScopes,
  reviewDeveloperScopes,
  revokeMyAuthorization,
  rotateDeveloperSecret,
  setDeveloperAppEnabled,
  updateDeveloperApp,
} from "@/lib/actions/developers"
import type { AuthorizationInput } from "@/lib/developers/policy"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs (consent and secrets stay
// on the page).

async function attempt<T>(run: () => Promise<T>) {
  try {
    const result = await run()
    revalidatePath("/developers", "layout")
    return { result }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}
const actor = () => requireActor("/developers")

export const registerApp = async (input: unknown) =>
  attempt(async () => runAction(registerDeveloperApp, await actor(), input))
export const updateApp = async (input: unknown) =>
  attempt(async () => runAction(updateDeveloperApp, await actor(), input))
export const rotateSecret = async (id: string) =>
  attempt(async () => runAction(rotateDeveloperSecret, await actor(), { id }))
export const setEnabled = async (id: string, enabled: boolean) =>
  attempt(async () =>
    runAction(setDeveloperAppEnabled, await actor(), { id, enabled })
  )
export const requestScopes = async (input: unknown) =>
  attempt(async () => runAction(requestDeveloperScopes, await actor(), input))
export const review = async (input: unknown) =>
  attempt(async () => runAction(reviewDeveloperScopes, await actor(), input))
export const revokeGrant = async (id: string) =>
  attempt(async () => runAction(revokeMyAuthorization, await actor(), { id }))

/** The consent page's answer; sends the browser back to the application. */
export async function decide(request: AuthorizationInput, form: FormData) {
  const member = await requireActor("/developers")
  const { redirect: target } = await runAction(authorizeDeveloperApp, member, {
    request,
    approve: form.get("decision") === "approve",
  })
  redirect(target)
}
