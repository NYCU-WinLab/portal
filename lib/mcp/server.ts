import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"

import { runAction } from "@/lib/actions/define"
import type { AdminApp } from "@/lib/apps"
import {
  callableActions,
  defaultToolsets,
  listedActions,
  routing,
} from "@/lib/mcp/toolsets"

export const instructions = `WinLab portal (NYCU Wireless Internet Lab). Every tool acts as the signed-in member, with exactly the permissions the web app gives them. Start with whoami. ${routing}`

// A fresh server per request, built from the action registry, so there is
// no hand-kept tool list to drift away from the pages. A member's list
// leaves out the tools only other apps' admins may run (extra.adminApps,
// from app/mcp/route.ts); runAction refuses those anyway. tools/list shows
// only the chosen toolsets (extra.toolsets); every other tool the member may
// run stays callable by name. Serves both the
// 2026-07-28 protocol and 2025-era clients.
export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.extra?.userId
  const adminOf = new Set(
    (authInfo?.extra?.adminApps as AdminApp[] | undefined) ?? []
  )
  const toolsets = new Set(
    (authInfo?.extra?.toolsets as string[] | undefined) ?? defaultToolsets
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
        inputSchema: action.input,
        annotations: { readOnlyHint: action.kind === "query" },
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
