import { afterEach, describe, expect, setSystemTime, test } from "bun:test"

import { labDirectory, labStatusOf } from "../lib/keycloak"

process.env.KEYCLOAK_ISSUER = "https://keycloak.test/realms/lab"

type Group = { id: string; name: string; people: string[] }

// Answers the Keycloak admin API with the given /lab-member children, in
// the order given, the way Keycloak may list them.
const serve = (groups: Group[]) => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    const json = (body: unknown) => Response.json(body)
    if (url.endsWith("/protocol/openid-connect/token"))
      return json({ access_token: "t", expires_in: 3600 })
    if (url.includes("/group-by-path/lab-member")) return json({ id: "root" })
    if (url.includes("/groups/root/children"))
      return json(groups.map(({ id, name }) => ({ id, name })))
    const group = groups.find((g) => url.includes(`/groups/${g.id}/members`))
    if (group) return json(group.people.map((id) => ({ id })))
    return new Response(null, { status: 404 })
  }) as typeof fetch
}

const realFetch = globalThis.fetch
let clock = Date.now()

// Every read starts past the 10-minute cache of the one before.
const read = async (groups: Group[]) => {
  clock += 11 * 60 * 1000
  setSystemTime(new Date(clock))
  serve(groups)
  return labDirectory()
}

afterEach(() => {
  globalThis.fetch = realFetch
  setSystemTime()
})

const master = { id: "g-master", name: "master", people: ["grad", "student"] }
const alumni = { id: "g-alumni", name: "alumni", people: ["grad", "old"] }
const doctoral = { id: "g-doctoral", name: "doctoral", people: ["phd"] }
const assistant = { id: "g-assistant", name: "assistant", people: ["phd"] }

describe("labDirectory with someone in two status groups", () => {
  test("alumni wins whichever order Keycloak lists the groups in", async () => {
    for (const groups of [
      [master, alumni],
      [alumni, master],
    ]) {
      const members = await read(groups)
      expect(members.get("grad")?.status).toBe("alumni")
      expect(members.get("student")?.status).toBe("master")
      expect(members.get("old")?.status).toBe("alumni")
    }
  })

  test("two current groups give the same status in either order", async () => {
    const a = (await read([doctoral, assistant])).get("phd")?.status
    const b = (await read([assistant, doctoral])).get("phd")?.status
    expect(a).toBe("assistant")
    expect(b).toBe(a)
  })
})

describe("labStatusOf", () => {
  test("alumni wins over any current status", () => {
    for (const status of ["teacher", "master", "undergrad"])
      expect(labStatusOf([status, "alumni"])).toBe("alumni")
  })

  test("otherwise the first in labStatuses", () => {
    expect(labStatusOf(["undergrad", "master"])).toBe("master")
  })

  test("ignores names that are not a status", () => {
    expect(labStatusOf(["114", "staff"])).toBeUndefined()
    expect(labStatusOf(["114", "doctoral"])).toBe("doctoral")
  })
})
