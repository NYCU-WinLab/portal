import { expect, test } from "bun:test"

import { LINK_MAIL_KINDS, MAIL_KINDS } from "./constants"

test("the mail kinds that carry a link token are redacted after sending", () => {
  expect([...LINK_MAIL_KINDS].sort()).toEqual([
    "changes_requested",
    "link",
    "received",
    "verify",
  ])
  for (const kind of LINK_MAIL_KINDS) expect(MAIL_KINDS).toContain(kind)
})
