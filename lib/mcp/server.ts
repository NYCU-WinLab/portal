import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"

import { runAction } from "@/lib/actions/define"
import type { AdminApp } from "@/lib/apps"
import { actions } from "@/lib/actions/registry"

export const instructions =
  "WinLab portal (NYCU Wireless Internet Lab). Every tool acts as the signed-in member, with exactly the permissions the web app gives them. Start with whoami."

// A fresh server per request, built from the action registry, so there is
// no hand-kept tool list to drift away from the pages. A member's list
// leaves out the tools only other apps' admins may run (extra.adminApps,
// from app/mcp/route.ts); runAction refuses those anyway. Serves both the
// 2026-07-28 protocol and 2025-era clients.
export const mcpHandler = createMcpHandler(({ authInfo }) => {
  const userId = authInfo?.extra?.userId
  const adminOf = new Set(
    (authInfo?.extra?.adminApps as AdminApp[] | undefined) ?? []
  )
  const server = new McpServer(
    { name: "winlab-portal", version: "0.1.0" },
    { instructions }
  )
  for (const action of actions) {
    if (action.mcpExcludedBecause) continue
    if (action.admin && !adminOf.has(action.admin)) continue
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
