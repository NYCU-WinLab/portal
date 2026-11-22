import { describe, expect, mock, test } from "bun:test"

import type { AdminApp } from "@/lib/apps"

// Tool calls reach runAction; record them instead of touching the database.
// Every call answers like whoami, the tool the test calls.
const calls: string[] = []
const define = await import("@/lib/actions/define")
mock.module("@/lib/actions/define", () => ({
  ...define,
  runAction: async (action: { name: string }) => {
    calls.push(action.name)
    return { id: "member-1", name: "王小明", email: "a@b.c", username: "a" }
  },
}))

const { instructions, mcpHandler } = await import("@/lib/mcp/server")
const { callableActions, listedActions, parseToolsets, routing } =
  await import("@/lib/mcp/toolsets")

const noAdmin = new Set<AdminApp>()
const url = "http://localhost/mcp"

/** One stateless JSON-RPC request through the real handler, as the route
 * makes it: the member's id, admin apps and chosen toolsets in authInfo. */
async function rpc(
  method: string,
  params: Record<string, unknown>,
  context: { adminApps?: AdminApp[]; toolsets?: string | null } = {}
) {
  const response = await mcpHandler.fetch(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    {
      authInfo: {
        token: "",
        clientId: "test",
        scopes: [],
        extra: {
          userId: "member-1",
          adminApps: context.adminApps ?? [],
          toolsets: [...parseToolsets(context.toolsets)],
        },
      },
    }
  )
  const text = await response.text()
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data:"))
    ?.slice(5)
  return JSON.parse(data ?? text) as {
    result?: Record<string, unknown>
    error?: { message: string }
  }
}

const listed = async (context?: Parameters<typeof rpc>[2]) =>
  (
    (await rpc("tools/list", {}, context)).result as {
      tools: { name: string }[]
    }
  ).tools.map((t) => t.name)

describe("mcpHandler", () => {
  test("the default list is listedActions", async () => {
    const names = await listed()
    expect(names.length).toBeGreaterThan(0)
    expect(names.sort()).toEqual(
      listedActions(noAdmin, parseToolsets(null))
        .map((a) => a.name)
        .sort()
    )
  })

  test("naming a toolset narrows the list, all lists every callable tool", async () => {
    const music = await listed({ toolsets: "music" })
    const every = await listed({ toolsets: "all" })
    expect(music.length).toBeGreaterThan(0)
    expect(music.length).toBeLessThan(every.length)
    expect(music.sort()).toEqual(
      listedActions(noAdmin, parseToolsets("music"))
        .map((a) => a.name)
        .sort()
    )
    expect(every.sort()).toEqual(
      callableActions(noAdmin)
        .map((a) => a.name)
        .sort()
    )
  })

  test("a tool hidden from the list can still be called by name", async () => {
    const shown = new Set(await listed({ toolsets: "music" }))
    const hidden = callableActions(noAdmin).find((a) => a.name === "whoami")
    expect(hidden).toBeDefined()
    expect(shown.has("whoami")).toBe(false)
    calls.length = 0
    const reply = await rpc(
      "tools/call",
      { name: hidden!.name, arguments: {} },
      { toolsets: "music" }
    )
    expect(reply.error).toBeUndefined()
    expect(reply.result?.isError).toBeFalsy()
    expect(calls).toEqual([hidden!.name])
  })

  test("an admin-only tool is refused for a member who is not its admin", async () => {
    const adminOnly = callableActions(new Set<AdminApp>(["portal"])).find(
      (a) => a.admin === "portal" && a.kind === "query"
    )
    expect(adminOnly).toBeDefined()
    expect(await listed({ toolsets: "all" })).not.toContain(adminOnly!.name)
    calls.length = 0
    const reply = await rpc("tools/call", {
      name: adminOnly!.name,
      arguments: {},
    })
    expect(reply.error !== undefined || reply.result?.isError === true).toBe(
      true
    )
    expect(calls).toEqual([])
    // Its admin sees and may call it.
    expect(await listed({ adminApps: ["portal"], toolsets: "all" })).toContain(
      adminOnly!.name
    )
  })

  test("instructions keep the routing paragraph and the toolset line", async () => {
    const reply = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    })
    const served = reply.result?.instructions as string
    expect(served).toBe(instructions)
    expect(served).toContain(routing)
    expect(routing).toContain("tools/list shows every tool unless you name")
    expect(served).toContain("Toolsets: ")
  })
})
