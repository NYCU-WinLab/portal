import { expect, test } from "bun:test"

import {
  LINK_MAIL_KINDS,
  MAIL_KINDS,
  USERNAME_PATTERN,
  USERNAME_PATTERN_CLIENT,
} from "./constants"

// Browsers compile an input's pattern with the `v` flag, which rejects an
// unescaped `-` in a class.
test("USERNAME_PATTERN_CLIENT compiles with v and agrees with USERNAME_PATTERN", () => {
  const client = new RegExp(`^(?:${USERNAME_PATTERN_CLIENT})$`, "v")
  const server = new RegExp(USERNAME_PATTERN)
  for (const s of [
    "xmwang",
    "a.b-c_d",
    "abc",
    "a".repeat(32),
    "ab",
    "a".repeat(33),
    "1abc",
    "Abc",
    "ab cd",
    "ab/cd",
    "a+b",
    "",
  ])
    expect([s, client.test(s)]).toEqual([s, server.test(s)])
})

test("the mail kinds that carry a link token are redacted after sending", () => {
  expect([...LINK_MAIL_KINDS].sort()).toEqual([
    "changes_requested",
    "link",
    "received",
    "verify",
  ])
  for (const kind of LINK_MAIL_KINDS) expect(MAIL_KINDS).toContain(kind)
})
