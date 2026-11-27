import { Email, Username } from "../domain/values"
import type { FakeKeycloak } from "./fake-keycloak"

/**
 * Keycloak's Admin REST routes over a FakeKeycloak, for running the Keycloak
 * contract against the real `KeycloakAdmin`. A group's id is its path.
 */
export function fakeKeycloakFetch(state: FakeKeycloak): typeof fetch {
  const json = (body: unknown, status = 200) => Response.json(body, { status })
  const empty = (status: number) => new Response("", { status })

  async function route(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? "GET"
    const path = url.pathname
    const body = init.body ? (JSON.parse(String(init.body)) as unknown) : null

    if (path.endsWith("/protocol/openid-connect/token"))
      return json({ access_token: "fake", expires_in: 300 })

    const admin = path.match(/\/admin\/realms\/[^/]+(\/.*)$/)?.[1]
    if (!admin) return empty(404)

    if (admin === "/users" && method === "GET") {
      const q = url.searchParams.get("q")
      const username = url.searchParams.get("username")
      const email = url.searchParams.get("email")
      if (q?.startsWith("portal_application_id:")) {
        const id = await state.findByApplicationId(
          q.slice("portal_application_id:".length)
        )
        return json(id ? [{ id }] : [])
      }
      if (username) {
        const taken = await state.usernamesTaken([Username.restore(username)])
        return json(taken.size > 0 ? [{ username }] : [])
      }
      if (email)
        return json(
          (await state.emailExists(Email.parse(email))) ? [{ email }] : []
        )
      return json([])
    }

    if (admin === "/users" && method === "POST") {
      const user = body as {
        username: string
        email: string
        firstName: string
        lastName: string
        attributes: Record<string, string[]>
        groups: string[]
      }
      const result = await state.createUser(user)
      if (result.ok)
        return new Response("", {
          status: 201,
          headers: { location: `${url.origin}${path}/${result.id}` },
        })
      return result.reason === "invalid" ? empty(400) : empty(409)
    }

    const group = admin.match(/^\/group-by-path(\/.+)$/)?.[1]
    if (group) {
      const path = decodeURIComponent(group)
      return (await state.groupExists(path))
        ? json({ id: path, path })
        : empty(404)
    }

    const member = admin.match(/^\/users\/([^/]+)\/groups\/(.+)$/)
    if (member) {
      const [, id, groupId] = member
      const path = decodeURIComponent(groupId)
      if (method === "PUT") {
        const r = await state.joinGroup(id, path)
        return empty(r === "ok" ? 204 : 404)
      }
      // Keycloak answers 403 once the user left what the client may see.
      const r = await state.leaveGroup(id, path)
      return empty(r === "ok" ? 204 : 403)
    }

    const mail = admin.match(/^\/users\/([^/]+)\/execute-actions-email$/)
    if (mail) {
      const r = await state.executeActionsEmail(mail[1], {
        lifespanSeconds: Number(url.searchParams.get("lifespan")),
        signal: init.signal ?? new AbortController().signal,
      })
      return empty(r === "ok" ? 204 : r === "user_gone" ? 404 : 400)
    }

    const user = admin.match(/^\/users\/([^/]+)$/)
    if (user) {
      const id = user[1]
      if (method === "GET") {
        const u = await state.readUser(id)
        return u ? json(u) : empty(404)
      }
      if (method === "PUT") {
        const r = await state.setEnabled(
          id,
          (body as { enabled: boolean }).enabled
        )
        return empty(r === "ok" ? 204 : 404)
      }
    }
    return empty(404)
  }

  return ((input: string | URL | Request, init: RequestInit = {}) =>
    route(new URL(String(input)), init)) as typeof fetch
}
