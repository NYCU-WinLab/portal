import { describe, expect, test } from "bun:test"

import { Application, type Assignment } from "../domain/application"
import { ProvisioningRun } from "../domain/provisioning-run"
import { KeycloakUnavailable } from "../ports"
import { FakeKeycloak } from "../testing/fake-keycloak"
import { FakeAuthority, FakeMailGroups } from "../testing/fakes"
import { ADMIN, NOW, assignment, pending } from "../testing/fixtures"
import {
  InMemoryApplicationStore,
  InMemorySettingsStore,
} from "../testing/memory-store"
import { StepError } from "./step-error"
import {
  CreateAccountStep,
  JoinMailGroupsStep,
  type ProvisioningStep,
  type StepResult,
} from "./steps"

const GROUP_ALL = "g-all"
const GROUP_LAB = "g-lab"

type Seed = {
  assignment?: Partial<Assignment>
  /** Null as after the reviewing admin's member row was deleted. */
  reviewedBy?: null
}

async function setup(seed: Seed = {}) {
  const store = await InMemoryApplicationStore.create()
  const keycloak = new FakeKeycloak()
  keycloak.addGroup("/provisioning")
  keycloak.addGroup("/lab-member/master")
  keycloak.addGroup("/lab-member/116")
  const base = await pending()
  const accepted = base.accept(
    assignment({ mailGroups: [GROUP_ALL, GROUP_LAB], ...seed.assignment }),
    base.version,
    ADMIN,
    NOW
  )
  if (accepted.kind !== "changed") throw new Error("accept did not change")
  const app =
    seed.reviewedBy === null
      ? Application.restore({ ...accepted.next.snapshot, reviewedBy: null })
      : accepted.next
  await store.transaction(async (uow) => {
    await uow.save({
      kind: "changed",
      previous: null,
      next: app,
      events: [],
      at: NOW,
    })
    await uow.saveRun(ProvisioningRun.start(app.id, NOW))
  })
  return { store, keycloak, app }
}
type H = Awaited<ReturnType<typeof setup>>

function exec(
  h: H,
  step: ProvisioningStep,
  signal: AbortSignal = new AbortController().signal
): Promise<StepResult> {
  return h.store.transaction(async (uow) => {
    const application = (await uow.lock(h.app.id))!
    const run = (await uow.lockRun(h.app.id))!
    return step.run({ application, run, uow, now: NOW, signal })
  })
}

const reload = (h: H) =>
  h.store.transaction(async (uow) => (await uow.lock(h.app.id))!)

async function blockedReason(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(StepError)
    expect((e as StepError).blocked).toBe(true)
    return (e as StepError).reason
  }
  throw new Error("expected the step to be blocked")
}

describe("create_account", () => {
  test("creates a disabled account in /provisioning and joins the lab groups", async () => {
    const h = await setup()
    const step = new CreateAccountStep(h.keycloak)
    expect(await exec(h, step)).toEqual({ kind: "done" })
    const id = (await reload(h)).keycloakId!
    expect(id).toBeTruthy()
    const user = h.keycloak.user(id)!
    expect(user.enabled).toBe(false)
    expect(user.username).toBe("xmwang")
    expect(user.attributes.portal_application_id).toEqual([h.app.id])
    expect(user.attributes.birthday).toEqual(["2001-02-03"])
    expect(user.attributes.nycu_email).toEqual(["xmwang@nycu.edu.tw"])
    expect(user.attributes.department).toEqual(["資工"])
    expect([...user.groups].sort()).toEqual([
      "/lab-member/116",
      "/lab-member/master",
      "/provisioning",
    ])
  })

  test("running it again creates no second account", async () => {
    const h = await setup()
    const step = new CreateAccountStep(h.keycloak)
    await exec(h, step)
    const first = (await reload(h)).keycloakId
    expect(await exec(h, step)).toEqual({ kind: "done" })
    expect((await reload(h)).keycloakId).toBe(first)
    expect(await h.keycloak.findByApplicationId(h.app.id)).toBe(first)
    expect(h.keycloak.userCount()).toBe(1)
  })

  test("an account made before the failed group join is found again", async () => {
    const h = await setup()
    const step = new CreateAccountStep(h.keycloak)
    h.keycloak.fail("joinGroup")
    await expect(exec(h, step)).rejects.toBeInstanceOf(KeycloakUnavailable)
    expect((await reload(h)).keycloakId).toBeNull()
    const existing = (await h.keycloak.findByApplicationId(h.app.id))!
    expect(existing).toBeTruthy()
    expect(await exec(h, step)).toEqual({ kind: "done" })
    expect((await reload(h)).keycloakId).toBe(existing)
    expect(h.keycloak.userCount()).toBe(1)
    expect([...h.keycloak.user(existing)!.groups].sort()).toEqual([
      "/lab-member/116",
      "/lab-member/master",
      "/provisioning",
    ])
  })

  test("a taken username is blocked", async () => {
    const h = await setup()
    await h.keycloak.createUser({
      username: "xmwang",
      email: "other@example.com",
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    const reason = await blockedReason(
      exec(h, new CreateAccountStep(h.keycloak))
    )
    expect(reason).toContain("xmwang")
  })

  test("a rejected account is blocked", async () => {
    const h = await setup()
    const lone = new FakeKeycloak()
    lone.addGroup("/lab-member/master")
    lone.addGroup("/lab-member/116")
    await blockedReason(exec(h, new CreateAccountStep(lone)))
  })

  test("an email that already has an account closes the application", async () => {
    const h = await setup()
    await h.keycloak.createUser({
      username: "someoneelse",
      email: h.app.email!.value,
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    expect(await exec(h, new CreateAccountStep(h.keycloak))).toEqual({
      kind: "close_has_account",
    })
  })

  test("a found account with another username is blocked", async () => {
    const h = await setup()
    await h.keycloak.createUser({
      username: "someoneelse",
      email: h.app.email!.value,
      firstName: "A",
      lastName: "B",
      attributes: { portal_application_id: [h.app.id] },
      groups: [],
    })
    const reason = await blockedReason(
      exec(h, new CreateAccountStep(h.keycloak))
    )
    expect(reason).toContain("someoneelse")
  })

  test("a found account with another email is blocked", async () => {
    const h = await setup()
    await h.keycloak.createUser({
      username: "xmwang",
      email: "different@example.com",
      firstName: "A",
      lastName: "B",
      attributes: { portal_application_id: [h.app.id] },
      groups: [],
    })
    await blockedReason(exec(h, new CreateAccountStep(h.keycloak)))
  })

  test("a saved account that was deleted restarts the run", async () => {
    const h = await setup()
    const step = new CreateAccountStep(h.keycloak)
    await exec(h, step)
    h.keycloak.deleteUser((await reload(h)).keycloakId!)
    expect(await exec(h, step)).toEqual({ kind: "restart" })
  })

  test("a missing cohort group is blocked and names the path", async () => {
    const h = await setup()
    const keycloak = new FakeKeycloak()
    keycloak.addGroup("/provisioning")
    keycloak.addGroup("/lab-member/master")
    const reason = await blockedReason(
      exec({ ...h, keycloak }, new CreateAccountStep(keycloak))
    )
    expect(reason).toContain("/lab-member/116")
  })

  test("a missing status group is blocked and names the path", async () => {
    const h = await setup()
    const keycloak = new FakeKeycloak()
    keycloak.addGroup("/provisioning")
    keycloak.addGroup("/lab-member/116")
    const reason = await blockedReason(
      exec({ ...h, keycloak }, new CreateAccountStep(keycloak))
    )
    expect(reason).toContain("/lab-member/master")
  })

  test("a Keycloak outage is thrown as it is", async () => {
    const h = await setup()
    h.keycloak.fail("createUser")
    await expect(
      exec(h, new CreateAccountStep(h.keycloak))
    ).rejects.toBeInstanceOf(KeycloakUnavailable)
  })
})

describe("join_mail_groups", () => {
  async function ready(seed: Seed = {}) {
    const h = await setup(seed)
    const groups = new FakeMailGroups({
      [GROUP_ALL]: { address: "all@winlab.tw" },
      [GROUP_LAB]: { address: "lab@winlab.tw" },
    })
    const authority = new FakeAuthority({
      managers: { [GROUP_ALL]: [ADMIN.id], [GROUP_LAB]: [ADMIN.id] },
    })
    const settings = new InMemorySettingsStore({
      [ADMIN.id]: { name: "管理員", email: "admin@winlab.tw" },
    })
    await settings.setMailGroup(GROUP_ALL, true, ADMIN.id)
    return { h, groups, authority, settings }
  }
  const addedAt = async (h: H) =>
    Object.fromEntries(
      (await reload(h)).assignment!.mailGroups.map((g) => [
        g.groupId,
        g.addedAt,
      ])
    )

  test("adds each group and stamps it, again with no change", async () => {
    const { h, groups, authority, settings } = await ready()
    const step = new JoinMailGroupsStep(groups, authority, settings)
    expect(await exec(h, step)).toEqual({ kind: "done" })
    const email = h.app.email!.value
    expect(groups.members(GROUP_ALL)).toEqual([email])
    expect(groups.members(GROUP_LAB)).toEqual([email])
    expect(await addedAt(h)).toEqual({ [GROUP_ALL]: NOW, [GROUP_LAB]: NOW })
    expect(await exec(h, step)).toEqual({ kind: "done" })
    expect(groups.members(GROUP_ALL)).toEqual([email])
    expect(await addedAt(h)).toEqual({ [GROUP_ALL]: NOW, [GROUP_LAB]: NOW })
  })

  test("a failed group is retried and nothing is added twice", async () => {
    const { h, groups, authority, settings } = await ready()
    const step = new JoinMailGroupsStep(groups, authority, settings)
    groups.failNext(GROUP_LAB)
    await expect(exec(h, step)).rejects.toMatchObject({ blocked: false })
    expect((await addedAt(h))[GROUP_LAB]).toBeNull()
    expect(await exec(h, step)).toEqual({ kind: "done" })
    expect(await addedAt(h)).toEqual({ [GROUP_ALL]: NOW, [GROUP_LAB]: NOW })
    expect(groups.members(GROUP_ALL)).toEqual([h.app.email!.value])
  })

  test("a member who is already in the group is stamped too", async () => {
    const { h, groups, authority, settings } = await ready()
    await groups.add(GROUP_ALL, h.app.email!, {
      actorId: null,
      isManager: async () => true,
    })
    const step = new JoinMailGroupsStep(groups, authority, settings)
    await exec(h, step)
    expect((await addedAt(h))[GROUP_ALL]).toEqual(NOW)
  })

  test("a reviewer who does not manage the group is blocked", async () => {
    const { h, groups, settings } = await ready()
    const authority = new FakeAuthority({ managers: { [GROUP_ALL]: [] } })
    const reason = await blockedReason(
      exec(h, new JoinMailGroupsStep(groups, authority, settings))
    )
    expect(reason.length).toBeGreaterThan(0)
  })

  test("with no reviewer, only a default group is added", async () => {
    const { h, groups, authority, settings } = await ready({ reviewedBy: null })
    const step = new JoinMailGroupsStep(groups, authority, settings)
    await blockedReason(exec(h, step))
    expect(groups.members(GROUP_LAB)).toEqual([])
    expect((await addedAt(h))[GROUP_LAB]).toBeNull()
  })

  test("with no reviewer and only default groups, it succeeds", async () => {
    const { h, groups, authority, settings } = await ready({
      reviewedBy: null,
      assignment: { mailGroups: [GROUP_ALL] },
    })
    const step = new JoinMailGroupsStep(groups, authority, settings)
    expect(await exec(h, step)).toEqual({ kind: "done" })
  })
})
