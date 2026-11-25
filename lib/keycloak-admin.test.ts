import { expect, test } from "bun:test"

import { Email, Username } from "@/lib/applications/domain/values"
import { KeycloakUnavailable } from "@/lib/applications/ports"
import { KeycloakAdmin } from "@/lib/keycloak"

const ISSUER = "https://sso.example.test/realms/lab"
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`
const ADMIN = "https://sso.example.test/admin/realms/lab"

type Handler = (
  url: URL,
  init: RequestInit,
  n: number
) => Response | Promise<Response>

function harness(handler: Handler) {
  const calls: { url: string; auth: string | null }[] = []
  let tokens = 0
  const fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {}
  ) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    calls.push({ url: String(input), auth: headers.get("authorization") })
    if (url.href === TOKEN_URL) {
      tokens += 1
      return Response.json({ access_token: `t${tokens}`, expires_in: 300 })
    }
    return handler(url, init, calls.length)
  }) as typeof globalThis.fetch
  const spans: { name: string; attributes: Record<string, unknown> }[] = []
  const span = (async (
    name: string,
    attributes: Record<string, string | number | boolean>,
    fn: () => Promise<unknown>
  ) => {
    spans.push({ name, attributes })
    return fn()
  }) as never
  const make = (extra: { timeoutMs?: number } = {}) =>
    new KeycloakAdmin({
      issuer: ISSUER,
      clientId: "c",
      clientSecret: "s",
      fetch,
      span,
      ...extra,
    })
  return { make, calls, spans, tokens: () => tokens }
}

const email = (s: string) => Email.parse(s)

test("a 401 drops the token, fetches a new one and retries once", async () => {
  const h = harness((_url, init) =>
    new Headers(init.headers).get("authorization") === "Bearer t1"
      ? new Response("", { status: 401 })
      : Response.json([{ email: "a@b.co" }])
  )
  expect(await h.make().emailExists(email("a@b.co"))).toBe(true)
  expect(h.tokens()).toBe(2)
})

test("a second 401 throws a plain Error, not KeycloakUnavailable", async () => {
  const h = harness(() => new Response("", { status: 401 }))
  const error = await h
    .make()
    .emailExists(email("a@b.co"))
    .catch((e) => e)
  expect(error).toBeInstanceOf(Error)
  expect(error).not.toBeInstanceOf(KeycloakUnavailable)
})

test("a 5xx throws KeycloakUnavailable", async () => {
  const h = harness(() => new Response("", { status: 503 }))
  await expect(h.make().groupExists("/lab-member")).rejects.toBeInstanceOf(
    KeycloakUnavailable
  )
})

test("a timeout throws KeycloakUnavailable", async () => {
  const h = harness(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        )
      })
  )
  await expect(
    h.make({ timeoutMs: 20 }).emailExists(email("a@b.co"))
  ).rejects.toBeInstanceOf(KeycloakUnavailable)
})

test("span names and attributes carry no query and no email", async () => {
  const h = harness(() => Response.json([]))
  await h.make().emailExists(email("secret@b.co"))
  const names = h.spans.map((s) => s.name)
  expect(names).toContain("keycloak GET /users")
  expect(names).toContain("keycloak POST /protocol/openid-connect/token")
  const text = JSON.stringify(h.spans)
  expect(text).not.toContain("?")
  expect(text).not.toContain("secret")
})

test("each instance fetches its own token", async () => {
  const h = harness(() => Response.json([]))
  await h.make().emailExists(email("a@b.co"))
  await h.make().emailExists(email("a@b.co"))
  expect(h.tokens()).toBe(2)
  const one = h.make()
  await one.emailExists(email("a@b.co"))
  await one.emailExists(email("a@b.co"))
  expect(h.tokens()).toBe(3)
})

test("emailExists asks for an exact match and compares case-insensitively", async () => {
  const h = harness(() => Response.json([{ email: "Alice@Lab.Test" }]))
  const kc = h.make()
  expect(await kc.emailExists(email("alice@lab.test"))).toBe(true)
  const asked = h.calls.find((c) => c.url.startsWith(`${ADMIN}/users`))!
  expect(new URL(asked.url).searchParams.get("exact")).toBe("true")
  expect(new URL(asked.url).searchParams.get("email")).toBe("alice@lab.test")
  const other = harness(() => Response.json([{ email: "alice2@lab.test" }]))
  expect(await other.make().emailExists(email("alice@lab.test"))).toBe(false)
})

test("usernamesTaken returns the lowercase names Keycloak has", async () => {
  const h = harness((url) =>
    Response.json(
      url.searchParams.get("username") === "alice"
        ? [{ username: "alice" }]
        : []
    )
  )
  const taken = await h
    .make()
    .usernamesTaken([Username.restore("alice"), Username.restore("bob")])
  expect([...taken]).toEqual(["alice"])
})

test("groupExists is true on 200 and false on 404", async () => {
  const h = harness((url) =>
    url.pathname.endsWith("/lab-member/114")
      ? Response.json({ id: "g" })
      : new Response("", { status: 404 })
  )
  const kc = h.make()
  expect(await kc.groupExists("/lab-member/114")).toBe(true)
  expect(await kc.groupExists("/lab-member/999")).toBe(false)
})
