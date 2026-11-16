"use server"

import { revalidatePath } from "next/cache"
import type { z } from "zod"

import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import {
  addSshKey,
  createSshService,
  deleteSshKey,
  deleteSshService,
  grantSshService,
  importSshKeys,
  revokeSshServiceGrant,
  rotateSshServiceKey,
  setSshKeyService,
} from "@/lib/actions/keys"
import { requireActor } from "@/lib/auth/session"

// The pages' writes: the same actions MCP runs (making and re-keying a
// service are page only), plus a refresh of /keys and /keys/services.

async function run<Input extends z.ZodObject, Output>(
  action: Action<Input, Output>,
  input: unknown
): Promise<{ error: string } | { error?: undefined; result: Output }> {
  const actor = await requireActor("/keys")
  try {
    const result = await runAction(action, actor, input)
    revalidatePath("/keys", "layout")
    return { result }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export async function addSshKeyAction(input: {
  public_key: string
  label: string
}) {
  const { error } = await run(addSshKey, input)
  return { error }
}

export async function importSshKeysAction(input: {
  host: string
  username: string
}) {
  const outcome = await run(importSshKeys, input)
  return outcome.error === undefined
    ? { added: outcome.result.added, skipped: outcome.result.skipped }
    : { error: outcome.error }
}

export async function deleteSshKeyAction(id: string) {
  const { error } = await run(deleteSshKey, { id })
  return { error }
}

export async function setSshKeyServiceAction(input: {
  id: string
  service: string
  used: boolean
}) {
  const { error } = await run(setSshKeyService, input)
  return { error }
}

export async function createSshServiceAction(input: {
  slug: string
  name: string
  open: boolean
}) {
  const outcome = await run(createSshService, input)
  return outcome.error === undefined
    ? { token: outcome.result.token, slug: outcome.result.slug }
    : { error: outcome.error }
}

export async function rotateSshServiceKeyAction(id: string) {
  const outcome = await run(rotateSshServiceKey, { id })
  return outcome.error === undefined
    ? { token: outcome.result.token, slug: outcome.result.slug }
    : { error: outcome.error }
}

export async function deleteSshServiceAction(id: string) {
  const { error } = await run(deleteSshService, { id })
  return { error }
}

export async function grantSshServiceAction(input: {
  id: string
  user_id: string
}) {
  const { error } = await run(grantSshService, input)
  return { error }
}

export async function revokeSshServiceGrantAction(input: {
  id: string
  user_id: string
}) {
  const { error } = await run(revokeSshServiceGrant, input)
  return { error }
}
