import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { announceChange } from "@/lib/actions/changes"
import type { AdminApp } from "@/lib/apps"
import { reloadGreetings } from "@/lib/display"
import { traced } from "@/lib/otel"

/**
 * Who is acting: the signed-in member, and whether through a page, an MCP
 * client or an API key on /api/actions (recorded on the action's span).
 * tokenId (the API key's id) and ip come only with via api.
 */
export type Actor = {
  userId: string
  via: "web" | "mcp" | "api"
  tokenId?: string
  ip?: string
}

/**
 * Every read and write the portal does is one of these, defined once. Pages
 * call it through runAction, and lib/mcp/server.ts turns each one into a
 * tool, so what a member can do on a page an agent can do through MCP. An
 * action that must stay off MCP says why in mcpExcludedBecause;
 * scripts/check-actions.ts fails CI on an action missing from the registry.
 */
export type Action<
  Input extends z.ZodObject = z.ZodObject,
  Output = unknown,
> = {
  /** snake_case; also the MCP tool name. */
  name: string
  /** What a member calls it, in Chinese: the MCP tool title. */
  title: string
  /** For agents, in English: when to use it and what it returns. */
  description: string
  /** query reads, mutation writes; MCP marks queries read-only. */
  kind: "query" | "mutation"
  input: Input
  run: (actor: Actor, input: z.infer<Input>) => Promise<Output>
  /** Only this app's admins may run it at all: runAction refuses anyone
   * else, and MCP leaves it out of their tool list. */
  admin?: AdminApp
  /** Set only to keep it off MCP, with the reason. */
  mcpExcludedBecause?: string
  /** Set when it changes what /api/door/greetings serves, so the door
   * panel fetches it again right after the change. */
  refreshesDoorPanel?: true
}

/** Names of every action created, for the registry check. */
export const defined = new Set<string>()

export function defineAction<Input extends z.ZodObject, Output>(
  action: Action<Input, Output>
): Action<Input, Output> {
  defined.add(action.name)
  return action
}

/** Parses the input the same way for pages and MCP, then runs it. */
export async function runAction<Input extends z.ZodObject, Output>(
  action: Action<Input, Output>,
  actor: Actor,
  /** Untrusted input from a page or an MCP client; parsed here either way. */
  input: unknown
): Promise<Output> {
  return traced(
    `action ${action.name}`,
    { "action.name": action.name, "action.kind": action.kind, via: actor.via },
    async () => {
      const parsed = action.input.parse(input)
      if (action.admin) await requireAdmin(actor, action.admin)
      const result = await action.run(actor, parsed)
      // Open pages refresh on this; a failed announcement never fails the
      // change itself.
      if (action.kind === "mutation")
        await announceChange(action.name).catch(() => {})
      if (action.kind === "mutation" && action.refreshesDoorPanel)
        void reloadGreetings()
      return result
    }
  )
}

/** What to tell a member when an action fails: the first input problem, or
 * the action's own message. */
export function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "輸入有誤"
  if (error instanceof Error) return error.message
  return "失敗了"
}
