import { afterEach, beforeEach, expect, test } from "bun:test"

import {
  deleteClientAsAdmin,
  reissueRegistrationToken,
} from "@/lib/keycloak-registration"

const ISSUER = "https://sso.example.test/realms/winlab"
const ADMIN = "https://sso.example.test/admin/realms/winlab"
const real = globalThis.fetch
let calls: { method: string; url: string; auth: string | null }[] = []

function stub(handler: (method: string, url: string) => Response) {
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    const url = String(input)
    const method = init?.method ?? "GET"
    calls.push({
      method,
      url,
      auth: new Headers(init?.headers).get("authorization"),
    })
    if (url === `${ISSUER}/protocol/openid-connect/token`)
      return Response.json({ access_token: "admin-token" })
    return handler(method, url)
  }) as typeof fetch
}

const lookup = `${ADMIN}/clients?clientId=app-1`

beforeEach(() => {
  process.env.KEYCLOAK_ISSUER = ISSUER
  process.env.KEYCLOAK_CLIENT_ID = "c"
  process.env.KEYCLOAK_CLIENT_SECRET = "s"
  calls = []
})
afterEach(() => {
  globalThis.fetch = real
})

test("reissue looks the client up, then posts for a new token", async () => {
  stub((method, url) =>
    url === lookup
      ? Response.json([{ id: "uuid-1", clientId: "app-1" }])
      : method === "POST" &&
          url === `${ADMIN}/clients/uuid-1/registration-access-token`
        ? Response.json({ registrationAccessToken: "new-rat" })
        : new Response(null, { status: 500 })
  )
  expect(await reissueRegistrationToken("app-1")).toBe("new-rat")
  const api = calls.filter((c) => c.url.startsWith(ADMIN))
  expect(api.map((c) => c.method)).toEqual(["GET", "POST"])
  expect(api.every((c) => c.auth === "Bearer admin-token")).toBe(true)
})

test("reissue throws when the client does not exist", async () => {
  stub(() => Response.json([]))
  expect(reissueRegistrationToken("app-1")).rejects.toThrow(
    "Keycloak client does not exist"
  )
})

test("delete looks the client up, then deletes it", async () => {
  stub((method, url) =>
    url === lookup
      ? Response.json([{ id: "uuid-1", clientId: "app-1" }])
      : method === "DELETE" && url === `${ADMIN}/clients/uuid-1`
        ? new Response(null, { status: 204 })
        : new Response(null, { status: 500 })
  )
  await deleteClientAsAdmin("app-1")
  expect(
    calls.filter((c) => c.url.startsWith(ADMIN)).map((c) => c.method)
  ).toEqual(["GET", "DELETE"])
})

test("delete counts a 404 as deleted", async () => {
  stub((method, url) =>
    url === lookup
      ? Response.json([{ id: "uuid-1", clientId: "app-1" }])
      : new Response(null, { status: 404 })
  )
  await deleteClientAsAdmin("app-1")
})

test("delete counts a missing client as deleted", async () => {
  stub(() => Response.json([]))
  await deleteClientAsAdmin("app-1")
  expect(calls.some((c) => c.method === "DELETE")).toBe(false)
})
