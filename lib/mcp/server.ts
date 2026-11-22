import {
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server"
import type { z } from "zod"

import { runAction, type Action } from "@/lib/actions/define"
import type { AdminApp } from "@/lib/apps"
import {
  callableActions,
  listedActions,
  routing,
  toolsetNames,
} from "@/lib/mcp/toolsets"

export const instructions = [
  "WinLab portal (NYCU Wireless Internet Lab). Every tool acts as the signed-in member, with exactly the permissions the web app gives them. Start with whoami.",
  "Tools by area: Monday lab meetings, presenters and papers (*_lab_meeting*, *_presenter*, *_paper*); booking rooms and meetings with members (book_meeting, *_meeting, *_appointment*, list_room_availability); calendars (*_calendar*); lunch orders (*_bento_*); the lab's music player, which the whole lab hears (*_song, *_queue, play_next, set_volume); the door: cards, opening it and what it says or plays (*_door_*, open_door); conference trips and their receipts (*_trip*); the lab fund (*_reimburse_*); accounting receipts (*_receipt*); documents sent round for signatures (*_approve_*); mailing lists (*_mail_group*); announcements (*_announcement*); leave from a lab meeting (*_leave*); SSH keys (*_ssh_*); profile and avatars (get_profile, *_avatar*).",
  "Take ids from a list_ or get_ tool, never guess them. Tools marked destructive change or remove data, mail people or act on the door: confirm those with the member first.",
  routing,
].join("\n")

/** Drops the regex zod adds next to format uuid: about 20 KB of tools/list
 * that tells an agent nothing format uuid does not. Validation is
 * unchanged: the SDK still runs zod, and runAction parses again. */
function withoutUuidPatterns(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutUuidPatterns)
  if (!schema || typeof schema !== "object") return schema
  const out: Record<string, unknown> = {}
  const node = schema as Record<string, unknown>
  for (const [key, value] of Object.entries(node))
    if (!(key === "pattern" && node.format === "uuid"))
      out[key] = withoutUuidPatterns(value)
  return out
}

/** The action's zod input as MCP serves it: zod validates, the advertised
 * JSON Schema leaves out the uuid patterns. */
export function servedInput(input: z.ZodObject): StandardSchemaWithJSON {
  const std = input["~standard"]
  return {
    "~standard": {
      ...std,
      jsonSchema: {
        input: (options) => withoutUuidPatterns(std.jsonSchema.input(options)),
        output: (options) =>
          withoutUuidPatterns(std.jsonSchema.output(options)),
      },
    },
  } as StandardSchemaWithJSON
}

/** Hints a client may use to decide what to run without asking. Every
 * mutation is destructive unless the action says it only adds. */
export function annotationsOf(action: Action) {
  if (action.kind === "query") return { readOnlyHint: true }
  return { readOnlyHint: false, destructiveHint: !action.additive }
}

// A fresh server per request, built from the action registry, so there is
// no hand-kept tool list to drift away from the pages. A member's list
// leaves out the tools only other apps' admins may run (extra.adminApps,
// from app/mcp/route.ts); runAction refuses those anyway. tools/list shows
// every tool unless the client named toolsets (extra.toolsets); every tool
// the member may run stays callable by name. Serves both the 2026-07-28
// protocol and 2025-era clients.
export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.extra?.userId
  const adminOf = new Set(
    (authInfo?.extra?.adminApps as AdminApp[] | undefined) ?? []
  )
  const toolsets = new Set(
    (authInfo?.extra?.toolsets as string[] | undefined) ?? toolsetNames
  )
  const listed = new Set(listedActions(adminOf, toolsets).map((a) => a.name))
  const server = new McpServer(
    { name: "winlab-portal", version: "0.1.0" },
    { instructions }
  )
  // The SDK lists every registered tool, so cut the list down on its way out.
  const setHandler = server.server.setRequestHandler.bind(server.server)
  server.server.setRequestHandler = ((method: string, handler: never) =>
    setHandler(
      method as never,
      (method === "tools/list"
        ? async (...args: unknown[]) => {
            const result = await (handler as (...a: unknown[]) => unknown)(
              ...args
            )
            const { tools } = result as { tools: { name: string }[] }
            return {
              ...(result as object),
              tools: tools.filter((t) => listed.has(t.name)),
            }
          }
        : handler) as never
    )) as typeof server.server.setRequestHandler
  for (const action of callableActions(adminOf)) {
    server.registerTool(
      action.name,
      {
        title: action.title,
        description: action.description,
        inputSchema: servedInput(action.input),
        annotations: annotationsOf(action),
      },
      async (input) => {
        if (typeof userId !== "string") throw new Error("not signed in")
        const result = await runAction(
          action,
          { userId, via: "mcp" },
          input ?? {}
        )
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        }
      }
    )
  }
  return server
})
