import { describe, expect, test } from "bun:test"

import contract from "@/contract/actions.json"

import { breaking, type Entry, type Schema } from "./api-compat"

const all = contract as Entry[]
const entry = (name: string) => {
  const found = all.find((e) => e.name === name)
  if (!found) throw new Error(`${name} not in the contract`)
  return structuredClone(found)
}
/** The object branch of a nullable object. */
const objectOf = (s: Schema) =>
  (s.anyOf as Schema[]).find((b) => b.type === "object") as {
    properties: Record<string, Schema>
    required: string[]
  }
const checkOutput = (name: string, change: (output: Schema) => void) => {
  const before = entry(name)
  const after = entry(name)
  change(after.output)
  return breaking([before], [after])
}

describe("breaking", () => {
  test("the contract is compatible with itself", () => {
    expect(breaking(all, all)).toEqual([])
  })

  test("a removed action", () => {
    expect(breaking([entry("now_playing")], [])).toEqual([
      "now_playing: removed",
    ])
  })

  test("an action moved to another app or to admins", () => {
    const after = entry("now_playing")
    after.app = "games"
    after.admin = "music"
    expect(breaking([entry("now_playing")], [after])).toHaveLength(2)
  })

  test("a new output key is fine", () => {
    expect(
      checkOutput("get_door_status", (o) => {
        ;(o.properties as Record<string, Schema>).extra = { type: "string" }
      })
    ).toEqual([])
  })

  test("a top-level output key removed", () => {
    expect(
      checkOutput("get_next_lab_meeting", (o) => {
        delete (o.properties as Record<string, Schema>).meeting
        o.required = []
      })
    ).not.toEqual([])
  })

  describe("inside a nullable object", () => {
    const meeting = (o: Schema) =>
      objectOf((o.properties as Record<string, Schema>).meeting!)

    test("a required key removed", () => {
      expect(
        checkOutput("get_next_lab_meeting", (o) => {
          const m = meeting(o)
          delete m.properties.location
          m.required = m.required.filter((k) => k !== "location")
        })
      ).toEqual([
        "get_next_lab_meeting output.meeting.location: may be missing",
      ])
    })

    test("a key changes type", () => {
      expect(
        checkOutput("get_next_lab_meeting", (o) => {
          meeting(o).properties.location = { type: "number" }
        })
      ).not.toEqual([])
    })

    test("an enum gains a value", () => {
      expect(
        checkOutput("get_next_lab_meeting", (o) => {
          ;(meeting(o).properties.kind!.enum as string[]).push("zzz")
        })
      ).toEqual([
        'get_next_lab_meeting output.meeting.kind: value "zzz" no longer allowed',
      ])
    })

    test("a nested nullable object loses a key", () => {
      expect(
        checkOutput("get_next_lab_meeting", (o) => {
          const p = objectOf(meeting(o).properties.presenter!)
          delete p.properties.id
          p.required = ["name"]
        })
      ).toEqual([
        "get_next_lab_meeting output.meeting.presenter.id: may be missing",
      ])
    })

    test("the object becomes always null", () => {
      expect(
        checkOutput("get_next_lab_meeting", (o) => {
          ;(o.properties as Record<string, Schema>).meeting = { type: "null" }
        })
      ).toEqual([])
      expect(
        checkOutput("get_door_status", (o) => {
          ;(o.properties as Record<string, Schema>).online = {
            anyOf: [{ type: "null" }, { type: "boolean" }],
          }
        })
      ).toEqual(["get_door_status output.online: null no longer allowed"])
    })
  })

  test("an input bound tightened", () => {
    const before = entry("search_music")
    const after = entry("search_music")
    ;(after.input.properties as Record<string, Schema>).query!.maxLength = 100
    expect(breaking([before], [after])).toEqual([
      "search_music input.query: maxLength tightened to 100",
    ])
  })

  test("an input key made required", () => {
    const before = entry("list_announcements")
    const after = entry("list_announcements")
    after.input.required = ["limit"]
    expect(breaking([before], [after])).toEqual([
      "list_announcements input.limit: now required",
    ])
  })
})

describe("the generated contract", () => {
  test("intersection types keep their keys", () => {
    const items = entry("list_reimburse_entries").output.properties as Record<
      string,
      Schema
    >
    const branches = (items.entries!.items as Schema).anyOf as Schema[]
    for (const branch of branches)
      expect(Object.keys(branch.properties as object).length).toBeGreaterThan(3)
  })

  test("a value read with [0] may be null", () => {
    const current = (
      entry("now_playing").output.properties as Record<string, Schema>
    ).current!
    expect((current.anyOf as Schema[]).map((b) => b.type).sort()).toEqual([
      "null",
      "object",
    ])
  })
})
