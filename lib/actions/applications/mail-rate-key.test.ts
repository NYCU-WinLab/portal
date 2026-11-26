import { afterEach, expect, test } from "bun:test"

import { mailRateKey } from "./mail-rate-key"

const saved = process.env.BETTER_AUTH_SECRET
afterEach(() => {
  if (saved === undefined) delete process.env.BETTER_AUTH_SECRET
  else process.env.BETTER_AUTH_SECRET = saved
})

test("derives 32 bytes, the same each time, from BETTER_AUTH_SECRET", () => {
  process.env.BETTER_AUTH_SECRET = "secret-one"
  const a = mailRateKey()
  expect(a).toHaveLength(32)
  expect(mailRateKey().equals(a)).toBe(true)
  // Never the secret itself.
  expect(a.equals(Buffer.from("secret-one"))).toBe(false)
})

test("another secret gives another key", () => {
  process.env.BETTER_AUTH_SECRET = "secret-one"
  const a = mailRateKey()
  process.env.BETTER_AUTH_SECRET = "secret-two"
  expect(mailRateKey().equals(a)).toBe(false)
})

test("a missing secret fails and names it", () => {
  delete process.env.BETTER_AUTH_SECRET
  expect(() => mailRateKey()).toThrow("BETTER_AUTH_SECRET")
})
