import { USERNAME_PATTERN } from "../domain/constants"
import type { Email, Username } from "../domain/values"
import {
  KeycloakUnavailable,
  type KeycloakDirectory,
  type KeycloakProvisioner,
  type NewKeycloakUser,
} from "../ports"

type FakeUser = {
  username: string
  email: string
  enabled: boolean
  groups: Set<string>
  attributes: Record<string, string[]>
  hasPassword: boolean
}

type Method = keyof KeycloakDirectory | keyof KeycloakProvisioner

export class FakeKeycloak implements KeycloakDirectory, KeycloakProvisioner {
  readonly mailsSent: { id: string; lifespanSeconds: number }[] = []
  cacheForgets = 0
  private readonly users = new Map<string, FakeUser>()
  private readonly groups = new Set<string>()
  private readonly failures = new Map<Method, number>()
  private badMail = false

  addGroup(path: string): void {
    this.groups.add(path)
  }
  setPassword(id: string): void {
    const u = this.users.get(id)
    if (u) u.hasPassword = true
  }
  deleteUser(id: string): void {
    this.users.delete(id)
  }
  user(id: string) {
    const u = this.users.get(id)
    if (!u) return undefined
    return {
      username: u.username,
      email: u.email,
      enabled: u.enabled,
      groups: new Set(u.groups),
      attributes: structuredClone(u.attributes),
    }
  }
  /** The next `times` calls of the method throw KeycloakUnavailable. */
  fail(method: Method, times = 1): void {
    this.failures.set(method, times)
  }
  misconfigureMail(on = true): void {
    this.badMail = on
  }

  private gate(method: Method): void {
    const left = this.failures.get(method) ?? 0
    if (left > 0) {
      this.failures.set(method, left - 1)
      throw new KeycloakUnavailable(`fake keycloak: ${method} unavailable`)
    }
  }

  async emailExists(email: Email): Promise<boolean> {
    this.gate("emailExists")
    return [...this.users.values()].some((u) => u.email === email.value)
  }
  async usernamesTaken(names: readonly Username[]): Promise<Set<string>> {
    this.gate("usernamesTaken")
    const have = new Set([...this.users.values()].map((u) => u.username))
    return new Set(
      names.map((n) => n.value.toLowerCase()).filter((n) => have.has(n))
    )
  }
  async groupExists(path: string): Promise<boolean> {
    this.gate("groupExists")
    return this.groups.has(path)
  }
  forgetCaches(): void {
    this.cacheForgets += 1
  }

  async findByApplicationId(id: string): Promise<string | null> {
    this.gate("findByApplicationId")
    for (const [key, u] of this.users) {
      if (u.attributes.portal_application_id?.includes(id)) return key
    }
    return null
  }
  async createUser(user: NewKeycloakUser) {
    this.gate("createUser")
    const username = user.username.toLowerCase()
    const email = user.email.toLowerCase()
    if (
      !new RegExp(USERNAME_PATTERN).test(username) ||
      !email.includes("@") ||
      user.groups.some((g) => !this.groups.has(g))
    ) {
      return { ok: false, reason: "invalid" } as const
    }
    const all = [...this.users.values()]
    if (all.some((u) => u.username === username)) {
      return { ok: false, reason: "username_taken" } as const
    }
    if (all.some((u) => u.email === email)) {
      return { ok: false, reason: "email_taken" } as const
    }
    const id = crypto.randomUUID()
    this.users.set(id, {
      username,
      email,
      enabled: false,
      groups: new Set(user.groups),
      attributes: structuredClone(user.attributes),
      hasPassword: false,
    })
    return { ok: true, id } as const
  }
  async readUser(id: string) {
    this.gate("readUser")
    const u = this.users.get(id)
    if (!u) return null
    return {
      username: u.username,
      email: u.email,
      enabled: u.enabled,
      attributes: structuredClone(u.attributes),
    }
  }
  async joinGroup(id: string, path: string) {
    this.gate("joinGroup")
    const u = this.users.get(id)
    if (!u) return "user_gone" as const
    if (!this.groups.has(path)) return "group_missing" as const
    u.groups.add(path)
    return "ok" as const
  }
  async leaveGroup(id: string, path: string) {
    this.gate("leaveGroup")
    const u = this.users.get(id)
    if (!u) return "gone" as const
    u.groups.delete(path)
    return "ok" as const
  }
  async setEnabled(id: string, enabled: boolean) {
    this.gate("setEnabled")
    const u = this.users.get(id)
    if (!u) return "user_gone" as const
    u.enabled = enabled
    return "ok" as const
  }
  async executeActionsEmail(
    id: string,
    opts: { lifespanSeconds: number; signal: AbortSignal }
  ) {
    this.gate("executeActionsEmail")
    if (!this.users.has(id)) return "user_gone" as const
    if (this.badMail) return "invalid" as const
    this.mailsSent.push({ id, lifespanSeconds: opts.lifespanSeconds })
    return "ok" as const
  }
  async hasPassword(id: string) {
    this.gate("hasPassword")
    const u = this.users.get(id)
    return u ? u.hasPassword : ("user_gone" as const)
  }
}
