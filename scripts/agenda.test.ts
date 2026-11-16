import { describe, expect, test } from "bun:test"

import { agendaLines } from "../lib/rooms/agenda"

describe("agendaLines", () => {
  test("a list keeps its items and drops the notes around it", () => {
    expect(
      agendaLines(
        "現場：太空中心 10F\n\n1. 範圍與行政\n2. 現況報告\n（午餐請回覆人數）"
      )
    ).toEqual(["範圍與行政", "現況報告"])
  })

  test("without a list every line is an item", () => {
    expect(agendaLines("6G")).toEqual(["6G"])
    expect(agendaLines("進度\n預算")).toEqual(["進度", "預算"])
    expect(agendaLines("1.5 倍的頻寬")).toEqual(["1.5 倍的頻寬"])
    expect(agendaLines("1.進度\n2、預算")).toEqual(["進度", "預算"])
  })

  test("headings, comments and indented lines are not items", () => {
    expect(
      agendaLines(
        '說明文字\n\n## 規則\n\n1. **不掛標籤**\n   `code` 的說明\n- 第二項\n\n<!-- winlab:booking\nrequest="x" -->'
      )
    ).toEqual(["**不掛標籤**", "第二項"])
  })

  test("an empty field has no items", () => {
    expect(agendaLines(null)).toEqual([])
    expect(agendaLines("\n\n")).toEqual([])
  })
})
