import { expect, test } from "bun:test"
import { TOKEN_HASH_PATTERN } from "./domain/constants"
import { CryptoTokens } from "./tokens"

test("generate makes a 43 character base64url token", () => {
  const { token } = new CryptoTokens().generate()
  expect(token).toHaveLength(43)
  expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
})

test("hash of the token equals the generated hash", () => {
  const t = new CryptoTokens()
  const g = t.generate()
  expect(t.hash(g.token).value).toBe(g.hash.value)
})

test("two tokens differ", () => {
  const t = new CryptoTokens()
  const a = t.generate()
  const b = t.generate()
  expect(a.token).not.toBe(b.token)
  expect(a.hash.value).not.toBe(b.hash.value)
})

test("hash is sha256 hex", () => {
  const h = new CryptoTokens().generate().hash.value
  expect(h).toMatch(new RegExp(TOKEN_HASH_PATTERN))
  expect(new CryptoTokens().hash("abc").value).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  )
})
