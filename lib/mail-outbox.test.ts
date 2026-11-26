import { expect, test } from "bun:test"

import { outboxBodyAfterSend } from "@/lib/mail-outbox"

test("a mail marked redact_after_send loses its body once sent", () => {
  expect(outboxBodyAfterSend(true)).toEqual({ text: "", html: null })
})

test("any other mail keeps its body", () => {
  expect(outboxBodyAfterSend(false)).toEqual({})
})
