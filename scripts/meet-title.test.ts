import { describe, expect, test } from "bun:test"

import { meetTitle } from "../lib/rooms/meeting"

describe("meetTitle", () => {
  test("a short title passes through", () => {
    expect(meetTitle({ title: "週會", meetingPrefix: null })).toBe("週會")
  })

  test("a long title is cut to 80 characters", () => {
    const title = "會".repeat(86)
    expect(Array.from(meetTitle({ title, meetingPrefix: null }))).toHaveLength(
      80
    )
  })

  test("the Teams prefix is dropped before the cut", () => {
    expect(meetTitle({ title: "[p]-週會", meetingPrefix: "p" })).toBe("週會")
  })
})
