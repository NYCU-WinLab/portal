import { describe, expect, test } from "bun:test"

import { asJson, servedOutput } from "@/lib/mcp/output"
import { callableActions } from "@/lib/mcp/toolsets"

const everyone = callableActions(
  new Set([
    "portal",
    "bento",
    "meetings",
    "receipts",
    "reimburse",
    "trip",
    "door",
    "assets",
  ] as const)
)

describe("mcp output schemas", () => {
  test("every callable tool has one", () => {
    for (const action of everyone)
      expect(servedOutput(action.name), action.name).toBeDefined()
  })

  test("unions of objects are served with an object root", () => {
    const json = servedOutput("book_meeting")!["~standard"].jsonSchema.output({
      target: "draft-2020-12",
    })
    expect(json.type).toBe("object")
  })

  test("a value as the client receives it validates", async () => {
    const std = servedOutput("list_lab_members")!["~standard"]
    const row = {
      id: "a",
      name: "n",
      name_en: "n",
      username: "u",
      email: null,
      phone: null,
      student_id: null,
      status: "master",
      cohort: 1,
      title: null,
    }
    expect(await std.validate(asJson([row]))).toHaveProperty("value")
    expect(await std.validate([{ ...row, status: "x" }])).toHaveProperty(
      "issues"
    )
  })
})
