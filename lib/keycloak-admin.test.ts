import { afterEach, expect, test } from "bun:test"

import { Email, Username } from "@/lib/applications/domain/values"
import { KeycloakUnavailable } from "@/lib/applications/ports"
import {
  KeycloakAdmin,
  keycloakProvisioner,
  systemAccountUsernames,
} from "@/lib/keycloak"

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
  const clientIds: (string | null)[] = []
  const fetch = (async (
    input: string | URL | Request,
    init: RequestInit = {}
  ) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    calls.push({ url: String(input), auth: headers.get("authorization") })
    if (url.href === TOKEN_URL) {
      tokens += 1
      clientIds.push(new URLSearchParams(String(init.body)).get("client_id"))
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
  const make = (
    extra: {
      timeoutMs?: number
      clientId?: string
      actionsEmail?: { clientId?: string; redirectUri?: string }
      reader?: KeycloakAdmin
    } = {}
  ) =>
    new KeycloakAdmin({
      issuer: ISSUER,
      clientId: "c",
      clientSecret: "s",
      fetch,
      span,
      ...extra,
    })
  return { make, calls, spans, clientIds, tokens: () => tokens }
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

test("by default it calls the fetch under Next's patch, read per call", async () => {
  const saved = globalThis.fetch
  const used: string[] = []
  const answer = (who: string) =>
    (async (input: string | URL | Request) => {
      used.push(who)
      return String(input) === TOKEN_URL
        ? Response.json({ access_token: "t", expires_in: 300 })
        : Response.json([])
    }) as typeof globalThis.fetch
  try {
    const admin = new KeycloakAdmin({
      issuer: ISSUER,
      clientId: "c",
      clientSecret: "s",
      span: (async (_n: string, _a: unknown, fn: () => Promise<unknown>) =>
        fn()) as never,
    })
    // Next patches fetch at request time, after the client is made.
    globalThis.fetch = Object.assign(answer("patched"), {
      _nextOriginalFetch: answer("original"),
    })
    expect(await admin.emailExists(email("a@b.co"))).toBe(false)
    expect(used).toEqual(["original", "original"])
    // Outside Next (scripts, tests) there is no patch: the global fetch.
    globalThis.fetch = answer("plain")
    admin.forgetCaches()
    await admin.emailExists(email("a@b.co"))
    expect(used.slice(2)).toEqual(["plain", "plain"])
  } finally {
    globalThis.fetch = saved
  }
})

test("the module-level reads turn a network error into KeycloakUnavailable", async () => {
  const saved = globalThis.fetch
  const env = { ...process.env }
  process.env.KEYCLOAK_ISSUER = ISSUER
  process.env.KEYCLOAK_CLIENT_ID = "c"
  process.env.KEYCLOAK_CLIENT_SECRET = "s"
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed")
  }) as unknown as typeof globalThis.fetch
  try {
    const error = await systemAccountUsernames().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(KeycloakUnavailable)
    expect((error as Error).cause).toBeInstanceOf(TypeError)
  } finally {
    globalThis.fetch = saved
    process.env = env
  }
})

test("a network error on the admin client keeps its cause", async () => {
  const h = harness(() => {
    throw new TypeError("fetch failed")
  })
  const error = await h
    .make()
    .usernamesTaken([Username.restore("someone")])
    .catch((e: unknown) => e)
  expect(error).toBeInstanceOf(KeycloakUnavailable)
  expect((error as Error).cause).toBeInstanceOf(TypeError)
})

// Provisioner writes

const USER = {
  username: "xmwang",
  email: "xmwang@example.com",
  firstName: "Xiao-Ming",
  lastName: "Wang",
  attributes: { portal_application_id: ["app-1"] },
  groups: ["/provisioning"],
}

const created = (id: string) =>
  new Response("", {
    status: 201,
    headers: { location: `${ADMIN}/users/${id}` },
  })

test("createUser returns the id from Location", async () => {
  let body: Record<string, unknown> = {}
  const h = harness(async (url, init) => {
    expect(url.pathname).toBe("/admin/realms/lab/users")
    expect(init.method).toBe("POST")
    body = JSON.parse(String(init.body))
    return created("abc")
  })
  expect(await h.make().createUser(USER)).toEqual({ ok: true, id: "abc" })
  expect(body.enabled).toBe(false)
  expect(body.emailVerified).toBe(true)
  expect(body.groups).toEqual(["/provisioning"])
  expect(body.attributes).toEqual({ portal_application_id: ["app-1"] })
})

test("createUser maps 409 to username_taken by an exact username lookup", async () => {
  const h = harness((url, init) => {
    if (init.method === "POST")
      return Response.json(
        { errorMessage: "User exists with same email" },
        { status: 409 }
      )
    expect(url.searchParams.get("exact")).toBe("true")
    return Response.json(
      url.searchParams.get("username") ? [{ username: "xmwang" }] : []
    )
  })
  expect(await h.make().createUser(USER)).toEqual({
    ok: false,
    reason: "username_taken",
  })
})

test("createUser maps 409 to email_taken when only the email matches", async () => {
  const h = harness((url, init) => {
    if (init.method === "POST")
      return Response.json(
        { errorMessage: "User exists with same username" },
        { status: 409 }
      )
    return Response.json(
      url.searchParams.get("email") ? [{ email: "xmwang@example.com" }] : []
    )
  })
  expect(await h.make().createUser(USER)).toEqual({
    ok: false,
    reason: "email_taken",
  })
})

test("createUser maps 400 to invalid", async () => {
  const h = harness(() => new Response("{}", { status: 400 }))
  expect(await h.make().createUser(USER)).toEqual({
    ok: false,
    reason: "invalid",
  })
})

test("leaveGroup treats 403 and 404 as gone", async () => {
  for (const status of [403, 404]) {
    const h = harness((url, init) =>
      url.pathname.includes("/group-by-path/")
        ? Response.json({ id: "g1" })
        : new Response("", { status: init.method === "DELETE" ? status : 500 })
    )
    expect(await h.make().leaveGroup("u1", "/provisioning")).toBe("gone")
  }
  const ok = harness((url) =>
    url.pathname.includes("/group-by-path/")
      ? Response.json({ id: "g1" })
      : new Response("", { status: 204 })
  )
  expect(await ok.make().leaveGroup("u1", "/provisioning")).toBe("ok")
  expect(ok.calls.at(-1)?.url).toBe(`${ADMIN}/users/u1/groups/g1`)
})

test("joinGroup maps a missing group and a missing user", async () => {
  const noGroup = harness(() => new Response("", { status: 404 }))
  expect(await noGroup.make().joinGroup("u1", "/mail")).toBe("group_missing")
  const noUser = harness((url) =>
    url.pathname.includes("/group-by-path/")
      ? Response.json({ id: "g1" })
      : new Response("", { status: 404 })
  )
  expect(await noUser.make().joinGroup("u1", "/mail")).toBe("user_gone")
})

test("executeActionsEmail sends UPDATE_PASSWORD with lifespan and passes the signal", async () => {
  let seen: { url: URL; init: RequestInit } | null = null
  const h = harness((url, init) => {
    seen = { url, init }
    return new Response("", { status: 204 })
  })
  const controller = new AbortController()
  const admin = h.make({
    actionsEmail: { clientId: "portal", redirectUri: "https://p.example.test" },
  })
  expect(
    await admin.executeActionsEmail("u1", {
      lifespanSeconds: 3600,
      signal: controller.signal,
    })
  ).toBe("ok")
  const { url, init } = seen!
  expect(init.method).toBe("PUT")
  expect(url.pathname).toBe("/admin/realms/lab/users/u1/execute-actions-email")
  expect(url.searchParams.get("lifespan")).toBe("3600")
  expect(url.searchParams.get("client_id")).toBe("portal")
  expect(url.searchParams.get("redirect_uri")).toBe("https://p.example.test")
  expect(JSON.parse(String(init.body))).toEqual(["UPDATE_PASSWORD"])
  controller.abort()
  expect(init.signal?.aborted).toBe(true)
})

test("a caller's signal is the deadline of its call, not the default timeout", async () => {
  const h = harness(
    (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(new Response("", { status: 204 })),
          50
        )
        init.signal?.addEventListener("abort", () => {
          clearTimeout(timer)
          reject(init.signal?.reason)
        })
      })
  )
  const admin = h.make({ timeoutMs: 20 })
  expect(
    await admin.executeActionsEmail("u1", {
      lifespanSeconds: 60,
      signal: AbortSignal.timeout(1000),
    })
  ).toBe("ok")
})

test("executeActionsEmail leaves out client_id and redirect_uri when unset", async () => {
  let search = ""
  const h = harness((url) => {
    search = url.search
    return new Response("", { status: 204 })
  })
  await h.make().executeActionsEmail("u1", {
    lifespanSeconds: 60,
    signal: new AbortController().signal,
  })
  expect(search).toBe("?lifespan=60")
})

test("executeActionsEmail maps 404 and 400", async () => {
  const opts = { lifespanSeconds: 60, signal: new AbortController().signal }
  expect(
    await harness(() => new Response("", { status: 404 }))
      .make()
      .executeActionsEmail("u1", opts)
  ).toBe("user_gone")
  expect(
    await harness(() => new Response("", { status: 400 }))
      .make()
      .executeActionsEmail("u1", opts)
  ).toBe("invalid")
})

test("setEnabled, readUser and findByApplicationId map their answers", async () => {
  const gone = harness(() => new Response("", { status: 404 }))
  expect(await gone.make().setEnabled("u1", true)).toBe("user_gone")
  expect(await gone.make().readUser("u1")).toBeNull()
  const found = harness((url) =>
    url.pathname.endsWith("/users")
      ? Response.json(url.searchParams.get("q") ? [{ id: "u9" }] : [])
      : Response.json({
          username: "x",
          email: "x@y.co",
          enabled: true,
          attributes: { a: ["1"] },
        })
  )
  const admin = found.make()
  expect(await admin.findByApplicationId("app-1")).toBe("u9")
  expect(found.calls[1].url).toContain("q=portal_application_id%3Aapp-1")
  expect(await admin.readUser("u9")).toEqual({
    username: "x",
    email: "x@y.co",
    enabled: true,
    attributes: { a: ["1"] },
  })
  const none = harness(() => Response.json([]))
  expect(await none.make().findByApplicationId("app-1")).toBeNull()
})

test("span paths carry no query string", async () => {
  const h = harness(() => Response.json([]))
  await h.make().findByApplicationId("app-1")
  expect(h.spans.length).toBeGreaterThan(0)
  for (const s of h.spans) {
    expect(JSON.stringify(s)).not.toContain("app-1")
    expect(s.name).not.toContain("?")
  }
})

test("provisioner and reader keep separate tokens", async () => {
  const h = harness(() => Response.json([]))
  const reader = h.make({ clientId: "portal" })
  const provisioner = h.make({ clientId: "portal-provisioner" })
  await reader.emailExists(email("a@b.co"))
  await provisioner.findByApplicationId("app-1")
  expect(h.tokens()).toBe(2)
  expect(h.clientIds).toEqual(["portal", "portal-provisioner"])
})

const ENV = [
  "KEYCLOAK_PROVISIONER_CLIENT_ID",
  "KEYCLOAK_PROVISIONER_CLIENT_SECRET",
] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test("keycloakProvisioner() throws when the env is missing", () => {
  for (const k of ENV) delete process.env[k]
  expect(() => keycloakProvisioner()).toThrow(
    "KEYCLOAK_PROVISIONER_CLIENT_ID and _SECRET must be set"
  )
  process.env.KEYCLOAK_PROVISIONER_CLIENT_ID = "portal-provisioner"
  expect(() => keycloakProvisioner()).toThrow(
    "KEYCLOAK_PROVISIONER_CLIENT_ID and _SECRET must be set"
  )
})

// The provisioner is scoped to a group: Keycloak answers 403 where it would
// have answered 404, and the portal client (the reader) tells the two apart.

const status = (code: number) => new Response("", { status: code })
const OPTS = { lifespanSeconds: 60, signal: new AbortController().signal }

test("createUser maps 403 to invalid", async () => {
  const h = harness(() => status(403))
  expect(await h.make().createUser(USER)).toEqual({
    ok: false,
    reason: "invalid",
  })
})

test("a write answered 403 is user_gone when the reader gets 404, else forbidden", async () => {
  const writes = {
    setEnabled: (a: KeycloakAdmin) => a.setEnabled("u1", true),
    joinGroup: (a: KeycloakAdmin) => a.joinGroup("u1", "/mail"),
    executeActionsEmail: (a: KeycloakAdmin) =>
      a.executeActionsEmail("u1", OPTS),
  }
  for (const [name, write] of Object.entries(writes)) {
    for (const [readerStatus, want] of [
      [404, "user_gone"],
      [200, "forbidden"],
    ] as const) {
      const asked: string[] = []
      const reader = harness((url) => {
        asked.push(url.pathname)
        return readerStatus === 404
          ? status(404)
          : Response.json({
              username: "x",
              email: "x@y.co",
              enabled: true,
            })
      })
      const provisioner = harness((url) =>
        url.pathname.includes("/group-by-path/")
          ? Response.json({ id: "g1" })
          : status(403)
      )
      const admin = provisioner.make({ reader: reader.make() })
      expect([name, await write(admin)]).toEqual([name, want])
      expect(asked).toEqual(["/admin/realms/lab/users/u1"])
    }
  }
})

test("a write answered 403 stays forbidden without a reader to ask", async () => {
  const h = harness(() => status(403))
  expect(await h.make().setEnabled("u1", true)).toBe("forbidden")
})

test("reads go through the reader and never touch the provisioner's own token", async () => {
  const reader = harness((url) => {
    if (url.pathname.endsWith("/users"))
      return Response.json(
        url.searchParams.get("q")
          ? [{ id: "u9" }]
          : [{ username: "xmwang", email: "xmwang@example.com" }]
      )
    return Response.json({
      username: "x",
      email: "x@y.co",
      enabled: true,
      attributes: { a: ["1"] },
    })
  })
  const provisioner = harness((url, init) =>
    init.method === "POST" ? status(409) : status(403)
  )
  const admin = provisioner.make({ reader: reader.make() })
  expect(await admin.findByApplicationId("app-1")).toBe("u9")
  expect((await admin.readUser("u9"))?.username).toBe("x")
  expect(await admin.createUser(USER)).toEqual({
    ok: false,
    reason: "username_taken",
  })
  expect(
    provisioner.calls.filter((c) => c.url.includes("/users?")).length
  ).toBe(0)
  expect(reader.calls.length).toBeGreaterThan(3)
})

test("readUser through the reader is null for a deleted user", async () => {
  const reader = harness(() => status(404))
  const admin = harness(() => status(403)).make({ reader: reader.make() })
  expect(await admin.readUser("u1")).toBeNull()
})
