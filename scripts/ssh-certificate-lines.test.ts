import { describe, expect, test } from "bun:test"

import {
  certificateLines,
  LAB_USER_CA,
  PRINCIPALS_PER_LINE,
} from "../lib/ssh-certificate-lines"

const names = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`)
const principals = (line: string) =>
  /^cert-authority,principals="([^"]*)" /.exec(line)?.[1].split(",") ?? []

describe("certificateLines", () => {
  test("no members, no line", () => {
    expect(certificateLines([])).toEqual([])
  })

  test("40 members fit one line", () => {
    const lines = certificateLines(names(40))
    expect(lines).toHaveLength(1)
    expect(principals(lines[0])).toEqual(names(40))
  })

  test("49 members split 40 and 9, every member on exactly one line", () => {
    const lines = certificateLines(names(49))
    expect(lines.map((l) => principals(l).length)).toEqual([40, 9])
    expect(lines.flatMap(principals)).toEqual(names(49))
  })

  test("no line names more than sshd reads", () => {
    for (const line of certificateLines(names(201)))
      expect(principals(line).length).toBeLessThanOrEqual(PRINCIPALS_PER_LINE)
  })

  test("every line trusts the lab CA", () => {
    for (const line of certificateLines(names(81)))
      expect(line.endsWith(` ${LAB_USER_CA} lab-ssh-ca`)).toBe(true)
  })
})
