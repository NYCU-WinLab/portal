import { describe, expect, test } from "bun:test"

import { actions } from "@/lib/actions/registry"
import type { AdminApp } from "@/lib/apps"
import { instructions } from "@/lib/mcp/server"
import {
  callableActions,
  listedActions,
  parseToolsets,
  routing,
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
  test("no selection lists every callable tool", () => {
    for (const raw of [null, undefined, "", " , ", "nope"]) {
      const chosen = parseToolsets(raw)
      expect(listedActions(noAdmin, chosen)).toEqual(callableActions(noAdmin))
      expect(listedActions(everyAdmin, chosen)).toEqual(
        callableActions(everyAdmin)
      )
    }
    const names = listedActions(noAdmin, parseToolsets(null)).map((a) => a.name)
    expect(names).toContain("whoami")
  })

  test("naming a toolset narrows the list", () => {
    const music = listedActions(noAdmin, parseToolsets("music"))
    expect(music.length).toBeGreaterThan(0)
    expect(music.length).toBeLessThan(callableActions(noAdmin).length)
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
    expect([...parseToolsets("nope")].sort()).toEqual([...toolsetNames].sort())
    expect([...parseToolsets("music,nope")]).toEqual(["music"])
  })

  test("the access toolset names account-application review", () => {
    const access = listedActions(
      new Set<AdminApp>(["accounts"]),
      parseToolsets("access")
    ).map((a) => a.name)
    expect(access).toContain("list_lab_applications")
    expect(access).toContain("set_application_notifiee")
    expect(routing).toContain("account-application review")
  })

  test("the instructions tell how to ask for another toolset", () => {
    expect(instructions).toContain("toolsets")
  })
})
