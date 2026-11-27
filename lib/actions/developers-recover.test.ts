import { beforeEach, expect, mock, test } from "bun:test"

import type { Actor } from "@/lib/actions/define"

// The database, the admin check and Keycloak are stubbed: the test follows
// what the action stores, and whom it refuses.
let row: { id: string; keycloakRat: string | null } | undefined
let admin = true
let stored: unknown[] = []
const reissued: string[] = []

const tx = {
  select: () => ({
    from: () => ({ where: () => ({ for: async () => (row ? [row] : []) }) }),
  }),
  update: () => ({
    set: (values: unknown) => ({
      where: async () => {
        stored.push(values)
      },
    }),
  }),
}

const db = await import("@/lib/db")
mock.module("@/lib/db", () => ({
  ...db,
  db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
}))
const authz = await import("@/lib/actions/authz")
mock.module("@/lib/actions/authz", () => ({
  ...authz,
  requireAdmin: async () => {
    if (!admin) throw new Error("forbidden")
  },
}))
const registration = await import("@/lib/keycloak-registration")
mock.module("@/lib/keycloak-registration", () => ({
  ...registration,
  reissueRegistrationToken: async (id: string) => {
    reissued.push(id)
    return "new-rat"
  },
}))

process.env.DEVELOPERS_SECRET = Buffer.alloc(32, 7).toString("base64")
const { recoverDeveloperAppToken } = await import("@/lib/actions/developers")
const { open, seal } = await import("@/lib/developers/seal")

const actor: Actor = { userId: "u1", via: "web" }
const id = "6f1c2b0e-8d1a-4c52-9a43-1f0f6a3b9c11"

beforeEach(() => {
  row = { id, keycloakRat: seal("old-rat") }
  admin = true
  stored = []
  reissued.length = 0
})

test("stores the new token, sealed", async () => {
  expect(await recoverDeveloperAppToken.run(actor, { id })).toEqual({ id })
  expect(reissued).toEqual([id])
  const [values] = stored as { keycloakRat: string }[]
  expect(values.keycloakRat).not.toBe("new-rat")
  expect(open(values.keycloakRat)).toBe("new-rat")
})

test("refuses a member who is not a portal admin", async () => {
  admin = false
  expect(recoverDeveloperAppToken.run(actor, { id })).rejects.toThrow()
  expect(reissued).toEqual([])
  expect(stored).toEqual([])
})

test("refuses an application that is not a Keycloak client", async () => {
  row = { id, keycloakRat: null }
  expect(recoverDeveloperAppToken.run(actor, { id })).rejects.toThrow()
  expect(reissued).toEqual([])
})
