import { expect, test } from "bun:test"
import type { GroupsApi } from "@/lib/groups/google"
import { Email } from "@/lib/applications/domain/values"
import { GoogleMailGroups } from "./mail-groups"

type Group = { id: string; email: string; name?: string }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

/** A Directory API in memory: groups, their parents, and the add reply. */
function fake(opts: {
  groups: Group[]
  parents?: Record<string, string[]>
  post?: (groupId: string, email: string) => Response
}) {
  const calls: { method: string; path: string; body?: string }[] = []
  const api: GroupsApi = {
    domain: "winlab.tw",
    token: async () => "token",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const path = url.pathname.replace("/admin/directory/v1/", "")
      const method = init?.method ?? "GET"
      calls.push({ method, path, body: init?.body as string | undefined })
      if (method === "POST") {
        const id = path.split("/")[1]!
        const email = JSON.parse(init!.body as string).email as string
        return opts.post ? opts.post(id, email) : json({ email })
      }
      if (path === "groups") {
        const key = url.searchParams.get("userKey")!
        return json({
          groups: (opts.parents?.[key] ?? []).map((email, i) => ({
            id: `p${i}`,
            email,
          })),
        })
      }
      const id = decodeURIComponent(path.split("/")[1]!)
      const group = opts.groups.find((g) => g.id === id)
      return group ? json(group) : json({ error: { message: "x" } }, 404)
    }) as typeof fetch,
  }
  return { api, calls }
}

const email = Email.parse("new.member@example.com")
const manager = (yes: boolean) => ({
  actorId: "u1",
  isManager: async () => yes,
})
const posts = (calls: { method: string }[]) =>
  calls.filter((c) => c.method === "POST")

test("add: a manager adds to a manageable group", async () => {
  const { api, calls } = fake({
    groups: [{ id: "g1", email: "lab-all@winlab.tw" }],
  })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.add("g1", email, manager(true))).toBe("ok")
  expect(posts(calls)).toHaveLength(1)
})

test("add: already a member", async () => {
  const { api } = fake({
    groups: [{ id: "g1", email: "lab-all@winlab.tw" }],
    post: () => json({}, 409),
  })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.add("g1", email, manager(true))).toBe("already")
})

test("add: a non-manager is denied before Google is asked", async () => {
  const { api, calls } = fake({
    groups: [{ id: "g1", email: "lab-all@winlab.tw" }],
  })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.add("g1", email, manager(false))).toBe("denied")
  expect(calls).toHaveLength(0)
})

test("add: a gcp-* group is protected", async () => {
  const { api, calls } = fake({
    groups: [{ id: "g1", email: "gcp-admins@winlab.tw" }],
  })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.add("g1", email, manager(true))).toBe("protected")
  expect(posts(calls)).toHaveLength(0)
})

test("add: a group nested in a gcp-* group is protected", async () => {
  const { api, calls } = fake({
    groups: [{ id: "g1", email: "lab-all@winlab.tw" }],
    parents: { "lab-all@winlab.tw": ["gcp-admins@winlab.tw"] },
  })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.add("g1", email, manager(true))).toBe("protected")
  expect(posts(calls)).toHaveLength(0)
})

test("add: a group Google does not know is protected", async () => {
  const { api } = fake({ groups: [] })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.add("gone", email, manager(true))).toBe("protected")
})

test("add: a Google failure is an error, and nothing logs the address", async () => {
  const { api } = fake({
    groups: [{ id: "g1", email: "lab-all@winlab.tw" }],
    post: () =>
      json({ error: { message: "boom new.member@example.com" } }, 500),
  })
  const logged: string[] = []
  const spy = (...args: unknown[]) => void logged.push(JSON.stringify(args))
  const [e, w] = [console.error, console.warn]
  console.error = spy
  console.warn = spy
  try {
    const groups = new GoogleMailGroups(() => api)
    expect(await groups.add("g1", email, manager(true))).toBe("error")
  } finally {
    console.error = e
    console.warn = w
  }
  expect(logged.join("\n")).not.toContain("new.member")
})

test("add: a failing manager check is an error", async () => {
  const { api } = fake({ groups: [{ id: "g1", email: "a@winlab.tw" }] })
  const groups = new GoogleMailGroups(() => api)
  const as = {
    actorId: "u1",
    isManager: async () => {
      throw new Error("db down")
    },
  }
  const quiet = console.error
  console.error = () => {}
  try {
    expect(await groups.add("g1", email, as)).toBe("error")
  } finally {
    console.error = quiet
  }
})

test("isManageable follows the groups rules", async () => {
  const { api } = fake({
    groups: [
      { id: "g1", email: "lab-all@winlab.tw" },
      { id: "g2", email: "gcp-admins@winlab.tw" },
      { id: "g3", email: "someone@other.example" },
    ],
  })
  const groups = new GoogleMailGroups(() => api)
  expect(await groups.isManageable("g1")).toBe(true)
  expect(await groups.isManageable("g2")).toBe(false)
  expect(await groups.isManageable("g3")).toBe(false)
  expect(await groups.isManageable("missing")).toBe(false)
})

test("addresses maps ids to addresses and skips the unknown", async () => {
  const { api } = fake({
    groups: [
      { id: "g1", email: "Lab-All@winlab.tw" },
      { id: "g2", email: "alumni@winlab.tw" },
    ],
  })
  const groups = new GoogleMailGroups(() => api)
  const map = await groups.addresses(["g1", "g2", "missing"])
  expect([...map]).toEqual([
    ["g1", "lab-all@winlab.tw"],
    ["g2", "alumni@winlab.tw"],
  ])
})

test("without Google credentials nothing is manageable and add errors", async () => {
  const groups = new GoogleMailGroups(() => null)
  expect(await groups.isManageable("g1")).toBe(false)
  expect(await groups.add("g1", email, manager(true))).toBe("error")
  expect((await groups.addresses(["g1"])).size).toBe(0)
})
