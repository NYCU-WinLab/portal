import { z } from "zod"

import { adminAppsOf } from "@/lib/actions/authz"
import { ApiRefusal, checkApiKey } from "@/lib/actions/api-keys"
import { type Action, errorMessage, runAction } from "@/lib/actions/define"
import { actions, appOfAction } from "@/lib/actions/registry"
import { apiApps } from "@/lib/api-apps"

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

type KeyHolder = { userId: string; keyId: string; apps: Set<string> }

/** The key in the Authorization header, or the response refusing it. */
export async function authenticate(
  request: Request
): Promise<KeyHolder | Response> {
  const token = /^Bearer (\S{1,256})$/i.exec(
    request.headers.get("authorization") ?? ""
  )?.[1]
  if (!token) return apiError(401, "missing bearer key")
  const check = await checkApiKey(token)
  if (!check.ok) return apiError(check.status, check.error)
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
  if (!action || action.mcpExcludedBecause)
    return apiError(404, `no action ${name}`)
  const app = appOfAction.get(name)
  if (!reachable(action, holder.apps))
    return apiError(
      403,
      app
        ? `this key is not allowed into ${app} (${apiApps[app]})`
        : `${name} cannot be called with an API key`
    )
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined
  try {
    const result = await runAction(
      action,
      { userId: holder.userId, via: "api", tokenId: holder.keyId, ip },
      input
    )
    return Response.json(result ?? null, { headers: noStore })
  } catch (error) {
    if (error instanceof ApiRefusal)
      return apiError(
        error.status,
        error.message,
        error.retryAfter ? { "retry-after": String(error.retryAfter) } : {}
      )
    return apiError(400, errorMessage(error))
  }
}

/** The JSON body as the action's input; {} when there is none. */
export async function readInput(
  request: Request
): Promise<{ input: unknown } | Response> {
  const length = Number(request.headers.get("content-length") ?? 0)
  if (length > MAX_BODY_BYTES) return apiError(413, "body over 20 MB")
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return apiError(413, "body over 20 MB")
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
