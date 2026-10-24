import { z } from "zod"

import { adminAppsOf } from "@/lib/actions/authz"
import { ApiRefusal, checkApiKey } from "@/lib/actions/api-keys"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { actions, appOfAction } from "@/lib/actions/registry"
import { apiApps } from "@/lib/api-apps"
import { recordRefusal } from "@/lib/otel"

// The HTTP API: the same actions as MCP and the pages, run with an API key
// as its owner, in the apps the key names. Actions kept off MCP are kept
// off here too, for the same reasons, and so are actions in no app.

const noStore = { "cache-control": "no-store" }
// Uploads (receipts, trip files, sounds) come as base64 in the body.
const MAX_BODY_BYTES = 20 * 1024 * 1024

export const apiError = (
  status: number,
  error: string,
  headers: Record<string, string> = {}
) => Response.json({ error }, { status, headers: { ...noStore, ...headers } })

/** apiError for a refused call, recorded as a span. */
function refuse(
  status: number,
  error: string,
  attributes: { action?: string; key?: string; retryAfter?: number } = {}
) {
  recordRefusal("api refused", {
    "http.status": status,
    "action.name": attributes.action,
    "api_key.id": attributes.key,
  })
  return apiError(
    status,
    error,
    attributes.retryAfter
      ? { "retry-after": String(attributes.retryAfter) }
      : {}
  )
}

type KeyHolder = { userId: string; keyId: string; apps: Set<string> }

/** The key in the Authorization header, or the response refusing it. */
export async function authenticate(
  request: Request
): Promise<KeyHolder | Response> {
  const token = /^Bearer (\S{1,256})$/i.exec(
    request.headers.get("authorization") ?? ""
  )?.[1]
  if (!token) return refuse(401, "missing bearer key")
  const check = await checkApiKey(token)
  if (!check.ok) return refuse(check.status, check.error)
  return { userId: check.userId, keyId: check.keyId, apps: new Set(check.apps) }
}

/** Whether the key may call this action at all: on MCP, in an app, and in
 * one of the key's apps. Admin rights are runAction's to check. */
function reachable(action: Action, apps: Set<string>) {
  const app = appOfAction.get(action.name)
  return !action.mcpExcludedBecause && !!app && apps.has(app)
}

/** Runs one action with the key, answering the way an HTTP client expects:
 * 200 with the result, 400 when the action says no, the refusal's own
 * status for ApiRefusal. */
export async function runWithKey(
  request: Request,
  holder: KeyHolder,
  name: string,
  input: unknown
) {
  const action = actions.find((a) => a.name === name)
  // The name comes from the URL: capped, so a span never carries a long one.
  const who = { action: name.slice(0, 64), key: holder.keyId }
  if (!action || action.mcpExcludedBecause)
    return refuse(404, `no action ${name}`, who)
  const app = appOfAction.get(name)
  if (!reachable(action, holder.apps))
    return refuse(
      403,
      app
        ? `this key is not allowed into ${app} (${apiApps[app]})`
        : `${name} cannot be called with an API key`,
      who
    )
  // The gateway in front of the portal appends the address it saw, so the
  // last entry is the one a client cannot set (issue 146).
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    undefined
  try {
    const result = await runAction(
      action,
      { userId: holder.userId, via: "api", tokenId: holder.keyId, ip },
      input
    )
    return Response.json(result ?? null, { headers: noStore })
  } catch (error) {
    if (error instanceof ApiRefusal)
      return refuse(error.status, error.message, {
        ...who,
        retryAfter: error.retryAfter,
      })
    return apiError(400, errorMessage(error))
  }
}

/** The JSON body as the action's input; {} when there is none. */
export async function readInput(
  request: Request
): Promise<{ input: unknown } | Response> {
  // Read up to the limit and stop, whatever Content-Length claims.
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return apiError(413, "body over 20 MB")
    }
    chunks.push(value)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (!text.trim()) return { input: {} }
  try {
    return { input: JSON.parse(text) }
  } catch {
    return apiError(400, "body is not JSON")
  }
}

/** The actions this key can call, with their input as JSON Schema. */
export async function listForKey(holder: KeyHolder) {
  const adminOf = await adminAppsOf({ userId: holder.userId, via: "api" })
  return actions
    .filter((action) => reachable(action, holder.apps))
    .filter((action) => !action.admin || adminOf.has(action.admin))
    .map((action) => ({
      name: action.name,
      title: action.title,
      description: action.description,
      kind: action.kind,
      app: appOfAction.get(action.name),
      input: z.toJSONSchema(action.input, { io: "input" }),
    }))
}

export { noStore }
