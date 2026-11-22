import { describe, expect, test } from "bun:test"

import { actions } from "@/lib/actions/registry"
import type { AdminApp } from "@/lib/apps"
import { instructions } from "@/lib/mcp/server"
import {
  callableActions,
  defaultToolsets,
  listedActions,
  parseToolsets,
  toolsetNames,
} from "@/lib/mcp/toolsets"

const everyAdmin = new Set<AdminApp>([
  "portal",
  "bento",
  "meetings",
  "receipts",
  "reimburse",
  "trip",
  "door",
  "assets",
])
const noAdmin = new Set<AdminApp>()

describe("toolsets", () => {
  test("the default list stays under 50 tools, even for an admin of everything", () => {
    const names = parseToolsets(null)
    expect(listedActions(everyAdmin, names).length).toBeLessThan(50)
    expect(listedActions(noAdmin, names).length).toBeGreaterThan(0)
  })

  test("the default includes whoami", () => {
    const names = listedActions(noAdmin, parseToolsets("")).map((a) => a.name)
    expect(names).toContain("whoami")
  })

  test("naming every toolset reaches every callable tool", () => {
    const all = parseToolsets("all")
    expect(listedActions(noAdmin, all)).toEqual(callableActions(noAdmin))
    for (const name of toolsetNames)
      expect(
        listedActions(everyAdmin, parseToolsets(name)).length
      ).toBeGreaterThan(0)
  })

  test("the admin filter holds for every selection", () => {
    for (const sel of ["all", "meetings", "access", ...toolsetNames]) {
      for (const a of listedActions(noAdmin, parseToolsets(sel)))
        expect(a.admin).toBeUndefined()
      for (const a of callableActions(noAdmin)) expect(a.admin).toBeUndefined()
    }
    const asMeetings = callableActions(new Set<AdminApp>(["meetings"]))
    expect(asMeetings.every((a) => !a.admin || a.admin === "meetings")).toBe(
      true
    )
    expect(asMeetings.some((a) => a.admin === "meetings")).toBe(true)
    expect(
      actions.filter((a) => a.admin && !a.mcpExcludedBecause).length
    ).toBeGreaterThan(0)
  })

  test("parsing", () => {
    expect([...parseToolsets("music, Bento")].sort()).toEqual([
      "bento",
      "music",
    ])
    expect([...parseToolsets("nope")].sort()).toEqual(
      [...defaultToolsets].sort()
    )
    expect(parseToolsets("default,music").has("profile")).toBe(true)
  })

  test("the instructions tell how to ask for another toolset", () => {
    expect(instructions).toContain("toolsets")
  })
})
