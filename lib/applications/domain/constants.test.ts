import { expect, test } from "bun:test"

import {
  LINK_MAIL_KINDS,
  EVENT_KINDS,
  MAIL_KINDS,
  STEP_NAMES,
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

test("provisioning has four steps and no password mail follow-up", () => {
  expect([...STEP_NAMES]).toEqual([
    "create_account",
    "join_mail_groups",
    "activate_and_mail",
    "finish",
  ])
  expect(EVENT_KINDS).toContain("password_mail_sent")
  for (const kind of [
    "password_mail_requested",
    "password_mail_expired",
    "password_set",
  ])
    expect(EVENT_KINDS).not.toContain(kind as never)
  expect(MAIL_KINDS).not.toContain("password_mail_expired" as never)
})
