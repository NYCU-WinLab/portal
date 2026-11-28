import { describe, expect, test } from "bun:test"
import { Email, Username } from "../domain/values"
import type {
  KeycloakDirectory,
  KeycloakProvisioner,
  NewKeycloakUser,
} from "../ports"

export type KeycloakSubject = {
  directory: KeycloakDirectory
  provisioner: KeycloakProvisioner
  addGroup(path: string): Promise<void>
  deleteUser(id: string): Promise<void>
  /** The user still exists, but the provisioner can no longer see or change it. */
  moveOutsideBoundary(id: string): Promise<void>
  /** The group exists, but the provisioner has no permission on it. */
  withholdGroupPermission(path: string): Promise<void>
}

const newUser = (o: Partial<NewKeycloakUser> = {}): NewKeycloakUser => ({
  username: "xmwang",
  email: "xmwang@example.com",
  firstName: "Xiao-Ming",
  lastName: "Wang",
  attributes: { portal_application_id: ["app-1"] },
  groups: ["/provisioning"],
  ...o,
})

async function created(s: KeycloakSubject, o?: Partial<NewKeycloakUser>) {
  const r = await s.provisioner.createUser(newUser(o))
  if (!r.ok) throw new Error(`createUser failed: ${r.reason}`)
  return r.id
}

/** Behaviour every Keycloak implementation (fake or real) must share. */
export function keycloakContract(make: () => Promise<KeycloakSubject>) {
  describe("keycloak contract", () => {
    test("createUser creates a disabled user findable by application id", async () => {
      const s = await make()
      const id = await created(s)
      expect(await s.provisioner.findByApplicationId("app-1")).toBe(id)
      expect(await s.provisioner.findByApplicationId("other")).toBeNull()
      const u = await s.provisioner.readUser(id)
      expect(u?.enabled).toBe(false)
      expect(u?.username).toBe("xmwang")
      expect(u?.attributes.portal_application_id).toEqual(["app-1"])
    })

    test("createUser reports username_taken before email_taken", async () => {
      const s = await make()
      await created(s)
      expect(await s.provisioner.createUser(newUser())).toEqual({
        ok: false,
        reason: "username_taken",
      })
      expect(
        await s.provisioner.createUser(newUser({ username: "other" }))
      ).toEqual({ ok: false, reason: "email_taken" })
    })

    test("createUser rejects an unknown group as invalid", async () => {
      const s = await make()
      expect(
        await s.provisioner.createUser(newUser({ groups: ["/nope"] }))
      ).toEqual({ ok: false, reason: "invalid" })
    })

    test("joinGroup reports group_missing and user_gone", async () => {
      const s = await make()
      const id = await created(s)
      await s.addGroup("/mail")
      expect(await s.provisioner.joinGroup(id, "/mail")).toBe("ok")
      expect(await s.provisioner.joinGroup(id, "/nope")).toBe("group_missing")
      await s.deleteUser(id)
      expect(await s.provisioner.joinGroup(id, "/mail")).toBe("user_gone")
    })

    test("joinGroup reports group_forbidden for a group the provisioner has no permission on", async () => {
      const s = await make()
      const id = await created(s)
      await s.addGroup("/lab-member/118")
      await s.withholdGroupPermission("/lab-member/118")
      expect(await s.provisioner.joinGroup(id, "/lab-member/118")).toBe(
        "group_forbidden"
      )
    })

    test("leaveGroup is gone for a deleted user and ok otherwise", async () => {
      const s = await make()
      const id = await created(s)
      expect(await s.provisioner.leaveGroup(id, "/provisioning")).toBe("ok")
      await s.deleteUser(id)
      expect(await s.provisioner.leaveGroup(id, "/provisioning")).toBe("gone")
    })

    test("setEnabled and executeActionsEmail report user_gone", async () => {
      const s = await make()
      const id = await created(s)
      expect(await s.provisioner.setEnabled(id, true)).toBe("ok")
      expect((await s.provisioner.readUser(id))?.enabled).toBe(true)
      const opts = {
        lifespanSeconds: 60,
        signal: new AbortController().signal,
      }
      expect(await s.provisioner.executeActionsEmail(id, opts)).toBe("ok")
      await s.deleteUser(id)
      expect(await s.provisioner.setEnabled(id, true)).toBe("user_gone")
      expect(await s.provisioner.executeActionsEmail(id, opts)).toBe(
        "user_gone"
      )
      expect(await s.provisioner.readUser(id)).toBeNull()
    })

    test("a user outside the boundary is forbidden for writes but still readable", async () => {
      const s = await make()
      const id = await created(s)
      await s.addGroup("/mail")
      await s.moveOutsideBoundary(id)
      const opts = {
        lifespanSeconds: 60,
        signal: new AbortController().signal,
      }
      expect(await s.provisioner.setEnabled(id, true)).toBe("forbidden")
      expect(await s.provisioner.joinGroup(id, "/mail")).toBe("forbidden")
      expect(await s.provisioner.executeActionsEmail(id, opts)).toBe(
        "forbidden"
      )
      expect(await s.provisioner.leaveGroup(id, "/provisioning")).toBe("gone")
      expect((await s.provisioner.readUser(id))?.username).toBe("xmwang")
      expect(await s.provisioner.findByApplicationId("app-1")).toBe(id)
    })

    test("directory reads what was created", async () => {
      const s = await make()
      await created(s)
      expect(
        await s.directory.emailExists(Email.parse("XMWANG@example.com"))
      ).toBe(true)
      expect(
        await s.directory.emailExists(Email.parse("nobody@example.com"))
      ).toBe(false)
      const taken = await s.directory.usernamesTaken([
        Username.restore("xmwang"),
        Username.restore("other"),
      ])
      expect([...taken]).toEqual(["xmwang"])
      expect(await s.directory.groupExists("/provisioning")).toBe(true)
      expect(await s.directory.groupExists("/nope")).toBe(false)
    })
  })
}
