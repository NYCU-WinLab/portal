import { describe, expect, test } from "bun:test"

import { Application } from "../domain/application"
import { STEP_NAMES } from "../domain/constants"
import {
  MailRatePolicy,
  RetentionPolicy,
  RetryPolicy,
} from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import { ApplicationRefusal } from "../domain/refusal"
import { Email } from "../domain/values"
import {
  KeycloakUnavailable,
  MailGroupsUnavailable,
  type ApplicationStore,
  type ReservedNames,
  type UnitOfWork,
} from "../ports"
import { FixedClock } from "../testing/clock"
import { FakeKeycloak } from "../testing/fake-keycloak"
import {
  FakeAuthority,
  FakeMailGroups,
  FixedReservedNames,
} from "../testing/fakes"
import { NOW, pending, profile } from "../testing/fixtures"
import {
  InMemoryApplicationStore,
  InMemorySettingsStore,
} from "../testing/memory-store"
import { SequentialTokens } from "../testing/tokens"
import { ApplicantService } from "./applicant-service"
import { MailComposer } from "./mail-composer"
import { ReviewService } from "./review-service"

process.env.BETTER_AUTH_URL = "https://portal.example.test"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const APPLY_SITE = "https://apply.example.test"
const SETTER = "00000000-0000-4000-8000-0000000000a1"
const PORTAL = "00000000-0000-4000-8000-000000000021"
const ACCOUNTS = "00000000-0000-4000-8000-000000000022"
const GROUP_MANAGER = "00000000-0000-4000-8000-000000000023"
const ADMIN_EMAILS = ["root1@winlab.tw", "root2@winlab.tw"]

type Setup = {
  wrap?: (store: InMemoryApplicationStore) => ApplicationStore
  reserved?: ReservedNames
}

/** Any pool or HTTP read made while a transaction is open fails the test. */
function guarded<T extends object>(
  target: T,
  tx: { in: boolean },
  label: string
): T {
  return new Proxy(target, {
    get(t, p) {
      const v = Reflect.get(t, p, t) as unknown
      if (typeof v !== "function") return v
      return (...args: unknown[]) => {
        if (tx.in) throw new Error(`${label}.${String(p)} inside a transaction`)
        return (v as (...a: unknown[]) => unknown).apply(t, args)
      }
    },
  })
}

async function setup(opts: Setup = {}) {
  const store = await InMemoryApplicationStore.create()
  const keycloak = new FakeKeycloak()
  keycloak.addGroup("/lab-member/116")
  const authority = new FakeAuthority({
    portalAdmins: [PORTAL],
    accountsAdminIds: [ACCOUNTS],
    managers: { "g-lab": [GROUP_MANAGER, ACCOUNTS] },
    processorEmails: ["processor@winlab.tw"],
    portalAdminEmails: ADMIN_EMAILS,
  })
  const settings = new InMemorySettingsStore({
    [SETTER]: { name: "王小明", email: "xmwang@winlab.tw" },
  })
  await settings.setApplySite(APPLY_SITE, SETTER, NOW)
  await settings.setMailGroup("g-all", true, SETTER)
  const mailGroups = new FakeMailGroups({
    "g-all": { address: "all@winlab.tw", manageable: true },
    "g-lab": { address: "lab@winlab.tw", manageable: true },
    "g-locked": { address: "locked@winlab.tw", manageable: false },
  })
  const tx = { in: false }
  const base: ApplicationStore = opts.wrap ? opts.wrap(store) : store
  const tracked: ApplicationStore = {
    reader: base.reader,
    transaction: async (work) => {
      tx.in = true
      try {
        return await base.transaction(work)
      } finally {
        tx.in = false
      }
    },
  }
  const clock = new FixedClock()
  const retention = new RetentionPolicy()
  const rate = new MailRatePolicy()
  const tokens = new SequentialTokens()
  const mail = new MailComposer({ siteUrl: "https://portal.example.test" })
  const service = new ReviewService({
    store: tracked,
    directory: guarded(keycloak, tx, "directory"),
    authority: guarded(authority, tx, "authority"),
    settings: guarded(settings, tx, "settings"),
    mailGroups: guarded(mailGroups, tx, "mailGroups"),
    reserved: opts.reserved ?? new FixedReservedNames(["root"]),
    mail,
    tokens,
    retention,
    rate,
    clock,
  })
  const applicant = new ApplicantService({
    store: tracked,
    directory: keycloak,
    authority,
    settings,
    reserved: new FixedReservedNames(["root"]),
    mail,
    tokens,
    retention,
    rate,
    clock,
    newId: () => crypto.randomUUID(),
  })
  return {
    store,
    keycloak,
    authority,
    settings,
    mailGroups,
    clock,
    retention,
    service,
    applicant,
    tokens,
  }
}
type H = Awaited<ReturnType<typeof setup>>

let seq = 0
/** A confirmed, pending application saved in the store. */
async function seed(
  h: H,
  opts: { at?: Date; email?: string; username?: string } = {}
): Promise<Application> {
  seq += 1
  const at = opts.at ?? h.clock.now()
  const app = await pending(at, {
    email: Email.parse(opts.email ?? `applicant${seq}@example.com`),
    profile: await profile({
      username: opts.username ?? `user${String(seq).padStart(4, "0")}`,
    }),
  })
  await h.store.transaction((uow) =>
    uow.save({ kind: "changed", previous: null, next: app, events: [], at })
  )
  return app
}

const assignment = (over: Record<string, unknown> = {}) => ({
  status: "master" as const,
  cohort: 116,
  username: "xmwang",
  mailGroups: ["g-all"],
  ...over,
})

async function refusal(p: Promise<unknown>): Promise<ApplicationRefusal> {
  const error = await p.then(
    () => {
      throw new Error("expected a refusal")
    },
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ApplicationRefusal)
  return error as ApplicationRefusal
}
const code = async (p: Promise<unknown>) => (await refusal(p)).code

const mails = (h: H) => h.store.outbox()
const kinds = (h: H) => mails(h).map((m) => m.mail.kind)
const item = async (h: H, id: string, closed = false) => {
  const found = (await h.service.list(PORTAL, { closed })).find(
    (i) => i.id === id
  )
  if (!found) throw new Error(`item ${id} is not listed`)
  return found
}

/** An accepted application whose run is finished (not released). */
async function accepted(h: H) {
  const app = await seed(h)
  await h.service.accept(ACCOUNTS, app.id, app.version, assignment())
  const now = h.clock.now()
  await h.store.transaction(async (uow) => {
    await uow.setKeycloakId(app.id, crypto.randomUUID())
    const finished = (await uow.lock(app.id))!.finish(now)
    if (finished.kind !== "changed") throw new Error("not finished")
    await uow.save(finished)
    let run = ProvisioningRun.start(app.id, now)
    for (const step of STEP_NAMES) run = run.complete(step, now)
    await uow.saveRun(run.finish(now, now))
  })
  return app
}

describe("list", () => {
  test("shows defaults, assignable statuses and the apply history", async () => {
    const h = await setup()
    const old = await seed(h, { email: "same@example.com" })
    await h.service.reject(ACCOUNTS, old.id)
    h.clock.advance(DAY)
    const app = await seed(h, { email: "same@example.com", username: "abcdef" })
    const accountsView = (
      await h.service.list(ACCOUNTS, { closed: false })
    ).find((i) => i.id === app.id)!
    expect(accountsView).toMatchObject({
      id: app.id,
      status: "pending",
      version: app.version,
      email: "same@example.com",
      requestedStatus: "master",
      defaults: { labStatus: "master", cohort: 116, mailGroups: ["g-all"] },
      assignableStatuses: ["master", "doctoral"],
      assignment: null,
      usernameTaken: false,
      provisioning: null,
      passwordMail: null,
    })
    expect(accountsView.profile?.username).toBe("abcdef")
    expect(accountsView.history.map((x) => [x.id, x.status])).toEqual([
      [old.id, "rejected"],
    ])
    const portalView = (await h.service.list(PORTAL, { closed: false })).find(
      (i) => i.id === app.id
    )!
    expect(portalView.assignableStatuses).toEqual([
      "master",
      "doctoral",
      "teacher",
      "assistant",
      "undergrad",
    ])
  })

  test("the cohort follows the Taipei academic year of the submission", async () => {
    const h = await setup()
    const before = await seed(h, { at: new Date("2026-08-31T15:59:00Z") })
    const after = await seed(h, { at: new Date("2026-08-31T16:00:00Z") })
    expect((await item(h, before.id)).defaults.cohort).toBe(115)
    expect((await item(h, after.id)).defaults.cohort).toBe(116)
  })

  test("a doctoral request defaults to doctoral", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.store.transaction(async (uow) => {
      const t = (await uow.lock(app.id))!.edit(
        {
          profile: app.profile!,
          requestedStatus: "doctoral",
        },
        app.version,
        { kind: "admin", id: ACCOUNTS },
        h.clock.now()
      )
      if (t.kind !== "changed") throw new Error("not changed")
      await uow.save(t)
    })
    expect((await item(h, app.id)).defaults.labStatus).toBe("doctoral")
  })

  test("usernameTaken sees Keycloak and other claims, and is null when Keycloak is down", async () => {
    const h = await setup()
    const a = await seed(h, { username: "taken-kc" })
    const b = await seed(h, { username: "claimed1" })
    const c = await seed(h, { username: "freeone1" })
    await h.keycloak.createUser({
      username: "taken-kc",
      email: "someone@example.com",
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    // Another application is provisioning as "claimed1".
    const other = await seed(h)
    await h.service.accept(
      ACCOUNTS,
      other.id,
      other.version,
      assignment({ username: "claimed1" })
    )
    const items = await h.service.list(ACCOUNTS, { closed: false })
    const taken = (id: string) => items.find((i) => i.id === id)!.usernameTaken
    expect(taken(a.id)).toBe(true)
    expect(taken(b.id)).toBe(true)
    expect(taken(c.id)).toBe(false)

    h.keycloak.fail("usernamesTaken")
    const down = await h.service.list(ACCOUNTS, { closed: false })
    expect(down.length).toBe(items.length)
    expect(down.every((i) => i.usernameTaken === null)).toBe(true)
  })

  test("any directory error leaves the list up, with usernameTaken null", async () => {
    const h = await setup()
    await seed(h)
    h.keycloak.fail(
      "usernamesTaken",
      1,
      new Error("KEYCLOAK_ISSUER is not set")
    )
    const items = await h.service.list(ACCOUNTS, { closed: false })
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.usernameTaken === null)).toBe(true)
  })

  test("open lists accepted applications until released; closed has the rest", async () => {
    const h = await setup()
    const done = await accepted(h)
    const rejected = await seed(h)
    await h.service.reject(ACCOUNTS, rejected.id)
    const waiting = await seed(h)
    const open = (await h.service.list(ACCOUNTS, { closed: false })).map(
      (i) => i.id
    )
    expect(open).toContain(done.id)
    expect(open).toContain(waiting.id)
    expect(open).not.toContain(rejected.id)
    expect(
      (await h.service.list(ACCOUNTS, { closed: true })).map((i) => i.id)
    ).toEqual([rejected.id])

    const view = await item(h, done.id)
    expect(view.passwordMail).toMatchObject({
      lastSentAt: null,
      passwordSet: false,
      canResend: true,
    })
    expect(view.provisioning?.steps.map((s) => s.name)).toEqual([...STEP_NAMES])
    expect(view.assignment?.mailGroups).toEqual([
      { groupId: "g-all", address: "all@winlab.tw", addedAt: null },
    ])

    await h.store.transaction(async (uow) => {
      await uow.saveRun((await uow.lockRun(done.id))!.release(h.clock.now()))
    })
    expect(
      (await h.service.list(ACCOUNTS, { closed: false })).map((i) => i.id)
    ).not.toContain(done.id)
    expect(
      (await h.service.list(ACCOUNTS, { closed: true })).map((i) => i.id)
    ).toContain(done.id)
  })

  test("events of a deleted processor keep their kind and lose the id", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.service.update(ACCOUNTS, app.id, app.version, {
      profile: { lineId: "newline" },
    })
    h.store.forgetAdmin(ACCOUNTS)
    const view = await item(h, app.id)
    expect(view.events.map((e) => [e.kind, e.actorKind, e.actorId])).toEqual([
      ["edited", "admin", null],
    ])
  })
})

describe("update", () => {
  test("changes a pending application and records old and new values", async () => {
    const h = await setup()
    const app = await seed(h)
    const r = await h.service.update(ACCOUNTS, app.id, app.version, {
      requestedStatus: "doctoral",
      profile: { lineId: "newline" },
    })
    expect(r).toEqual({ ok: true, version: app.version + 1 })
    const view = await item(h, app.id)
    expect(view.requestedStatus).toBe("doctoral")
    expect(view.profile?.lineId).toBe("newline")
    expect(view.events[0]).toMatchObject({
      kind: "edited",
      actorKind: "admin",
      actorId: ACCOUNTS,
    })
    expect(view.events[0].changes).toMatchObject({
      line_id: { from: "xmwang", to: "newline" },
      requested_status: { from: "master", to: "doctoral" },
    })
    expect(mails(h)).toEqual([])
  })

  test("an edit that changes nothing writes nothing", async () => {
    const h = await setup()
    const app = await seed(h)
    const r = await h.service.update(ACCOUNTS, app.id, app.version, {
      profile: { lineId: "xmwang" },
    })
    expect(r).toEqual({ ok: true, version: app.version })
    expect((await item(h, app.id)).events).toEqual([])
  })

  test("an edit that keeps the username does not ask for reserved names", async () => {
    const down: ReservedNames = {
      has: async () => {
        throw new KeycloakUnavailable("reserved names unavailable")
      },
    }
    const h = await setup({ reserved: down })
    const app = await seed(h)
    const r = await h.service.update(ACCOUNTS, app.id, app.version, {
      profile: { username: app.profile!.fields.username, lineId: "newline" },
    })
    expect(r).toEqual({ ok: true, version: app.version + 1 })
    await expect(
      h.service.update(ACCOUNTS, app.id, app.version + 1, {
        profile: { username: "other" },
      })
    ).rejects.toBeInstanceOf(KeycloakUnavailable)
  })

  test("refusals: stale version, wrong state, bad input", async () => {
    const h = await setup()
    const app = await seed(h)
    expect(
      await code(
        h.service.update(ACCOUNTS, app.id, app.version + 1, {
          profile: { lineId: "x" },
        })
      )
    ).toBe("version_conflict")
    const bad = await refusal(
      h.service.update(ACCOUNTS, app.id, app.version, {
        profile: { phone: "123" },
      })
    )
    expect([bad.code, bad.field]).toEqual(["invalid_input", "phone"])
    await h.service.reject(ACCOUNTS, app.id)
    const rejected = await item(h, app.id, true)
    expect(
      await code(
        h.service.update(ACCOUNTS, app.id, rejected.version, {
          profile: { lineId: "x" },
        })
      )
    ).toBe("wrong_state")
  })
})

describe("requestChanges", () => {
  test("asks for changes for 7 days, with a new link and a mail", async () => {
    const h = await setup()
    const app = await seed(h)
    const r = await h.service.requestChanges(
      ACCOUNTS,
      app.id,
      app.version,
      " 學號打錯了 "
    )
    expect(r.version).toBe(app.version + 1)
    const view = await item(h, app.id)
    expect(view.status).toBe("changes_requested")
    expect(view.changeRequest).toEqual({
      note: "學號打錯了",
      dueAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
      expired: false,
    })
    expect(kinds(h)).toEqual(["changes_requested"])
    const mail = mails(h)[0]
    expect(mail.mail.to).toBe(app.email!.value)
    expect(mail.mail.text).toContain("學號打錯了")
    const token = /\/status\?token=([A-Za-z0-9_-]+)/.exec(mail.mail.text)![1]
    expect(mail.mail.text).toContain(`${APPLY_SITE}/status?token=`)
    const status = await h.applicant.getStatus(token)
    expect(status.status).toBe("changes_requested")
  })

  test("a second request while the first is open is wrong_state; after it expires it opens a new one", async () => {
    const h = await setup()
    const app = await seed(h)
    const first = await h.service.requestChanges(
      ACCOUNTS,
      app.id,
      app.version,
      "one"
    )
    expect(
      await code(
        h.service.requestChanges(ACCOUNTS, app.id, first.version, "two")
      )
    ).toBe("wrong_state")
    h.clock.advance(7 * DAY + 1)
    const second = await h.service.requestChanges(
      ACCOUNTS,
      app.id,
      first.version,
      "two"
    )
    expect(second.version).toBe(first.version + 1)
    const view = await item(h, app.id)
    expect(view.changeRequest?.note).toBe("two")
    expect(view.changeRequest?.dueAt).toBe(
      new Date(h.clock.now().getTime() + 7 * DAY).toISOString()
    )
    expect(kinds(h)).toEqual(["changes_requested", "changes_requested"])
  })

  test("a blank note and a stale version are refused and send nothing", async () => {
    const h = await setup()
    const app = await seed(h)
    const blank = await refusal(
      h.service.requestChanges(ACCOUNTS, app.id, app.version, "  ")
    )
    expect([blank.code, blank.field]).toEqual(["invalid_input", "note"])
    expect(
      await code(h.service.requestChanges(ACCOUNTS, app.id, 99, "note"))
    ).toBe("version_conflict")
    expect(mails(h)).toEqual([])
  })

  test("a failing queue rolls back the status and the token", async () => {
    let fail = false
    const h = await setup({
      wrap: (inner) => ({
        reader: inner.reader,
        transaction: (work) =>
          inner.transaction((uow) =>
            work({
              ...uow,
              queueMail: async (id, mail) => {
                if (fail) throw new Error("outbox down")
                return uow.queueMail(id, mail)
              },
            } as UnitOfWork)
          ),
      }),
    })
    const app = await seed(h)
    fail = true
    await expect(
      h.service.requestChanges(ACCOUNTS, app.id, app.version, "note")
    ).rejects.toThrow("outbox down")
    const view = await item(h, app.id)
    expect(view.status).toBe("pending")
    expect(view.version).toBe(app.version)
    expect(mails(h)).toEqual([])
  })
})

describe("accept", () => {
  test("moves to provisioning, starts the run and keeps the mail groups", async () => {
    const h = await setup()
    const app = await seed(h)
    const r = await h.service.accept(
      ACCOUNTS,
      app.id,
      app.version,
      assignment({ mailGroups: ["g-all", "g-lab"] })
    )
    expect(r).toEqual({ ok: true, version: app.version + 1 })
    const view = await item(h, app.id)
    expect(view.status).toBe("provisioning")
    expect(view.assignment).toMatchObject({
      status: "master",
      cohort: 116,
      username: "xmwang",
    })
    expect(view.assignment?.mailGroups.map((g) => g.groupId).sort()).toEqual([
      "g-all",
      "g-lab",
    ])
    expect(view.provisioning).toMatchObject({
      attempts: 0,
      finishedAt: null,
      steps: [],
    })
    expect(view.events.map((e) => [e.kind, e.actorId])).toEqual([
      ["accepted", ACCOUNTS],
    ])
    expect(mails(h)).toEqual([])
  })

  test("the same assignment again changes nothing; another one is already_decided", async () => {
    const h = await setup()
    const app = await seed(h)
    const first = await h.service.accept(
      ACCOUNTS,
      app.id,
      app.version,
      assignment()
    )
    // Keycloak now knows the user: an idempotent retry must not trip on it.
    await h.keycloak.createUser({
      username: "xmwang",
      email: app.email!.value,
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    expect(
      await h.service.accept(ACCOUNTS, app.id, app.version, assignment())
    ).toEqual({ ok: true, version: first.version })
    expect((await item(h, app.id)).events).toHaveLength(1)
    expect(
      await code(
        h.service.accept(
          ACCOUNTS,
          app.id,
          app.version,
          assignment({ cohort: 117 })
        )
      )
    ).toBe("already_decided")
  })

  test("a stale version is refused", async () => {
    const h = await setup()
    const app = await seed(h)
    expect(
      await code(h.service.accept(ACCOUNTS, app.id, 99, assignment()))
    ).toBe("version_conflict")
  })

  test("only a portal admin may give teacher, assistant or undergrad", async () => {
    const h = await setup()
    const app = await seed(h)
    expect(
      await code(
        h.service.accept(
          ACCOUNTS,
          app.id,
          app.version,
          assignment({ status: "teacher" })
        )
      )
    ).toBe("status_not_allowed")
    expect((await item(h, app.id)).status).toBe("pending")
    await h.service.accept(
      PORTAL,
      app.id,
      app.version,
      assignment({ status: "teacher", mailGroups: [] })
    )
    expect((await item(h, app.id)).assignment?.status).toBe("teacher")
  })

  test("mail groups must be a default or managed by the actor, and manageable", async () => {
    const h = await setup()
    const app = await seed(h)
    // g-lab is not a default and ACCOUNTS manages it: fine.
    // g-locked is not manageable at all.
    expect(
      await code(
        h.service.accept(
          ACCOUNTS,
          app.id,
          app.version,
          assignment({ mailGroups: ["g-locked"] })
        )
      )
    ).toBe("mail_group_not_allowed")
    // PORTAL does not manage g-lab and it is not a default.
    expect(
      await code(
        h.service.accept(
          PORTAL,
          app.id,
          app.version,
          assignment({ mailGroups: ["g-lab"] })
        )
      )
    ).toBe("mail_group_not_allowed")
    // A group nobody knows is not manageable either.
    expect(
      await code(
        h.service.accept(
          ACCOUNTS,
          app.id,
          app.version,
          assignment({ mailGroups: ["g-nope"] })
        )
      )
    ).toBe("mail_group_not_allowed")
    expect((await item(h, app.id)).status).toBe("pending")
    await h.service.accept(
      ACCOUNTS,
      app.id,
      app.version,
      assignment({ mailGroups: ["g-all", "g-lab"] })
    )
  })

  test("Google being unreachable is not a refusal of the group", async () => {
    const h = await setup()
    const app = await seed(h)
    h.mailGroups.unreachable = true
    await expect(
      h.service.accept(
        ACCOUNTS,
        app.id,
        app.version,
        assignment({ mailGroups: ["g-lab"] })
      )
    ).rejects.toBeInstanceOf(MailGroupsUnavailable)
    expect((await item(h, app.id)).status).toBe("pending")
  })

  test("a username that Keycloak has or another application claims is refused", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.keycloak.createUser({
      username: "xmwang",
      email: "other@example.com",
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    expect(
      await code(h.service.accept(ACCOUNTS, app.id, app.version, assignment()))
    ).toBe("username_unavailable")

    const rival = await seed(h)
    await h.service.accept(
      ACCOUNTS,
      rival.id,
      rival.version,
      assignment({ username: "claimed2" })
    )
    expect(
      await code(
        h.service.accept(
          ACCOUNTS,
          app.id,
          app.version,
          assignment({ username: "claimed2" })
        )
      )
    ).toBe("username_unavailable")
    expect((await item(h, app.id)).status).toBe("pending")
  })

  test("an email that already has an account is refused", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.keycloak.createUser({
      username: "someoneelse",
      email: app.email!.value,
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    expect(
      await code(h.service.accept(ACCOUNTS, app.id, app.version, assignment()))
    ).toBe("email_has_account")
    expect((await item(h, app.id)).status).toBe("pending")
  })

  test("Keycloak being down is a plain error and writes nothing", async () => {
    const h = await setup()
    const app = await seed(h)
    h.keycloak.fail("usernamesTaken")
    const error = await h.service
      .accept(ACCOUNTS, app.id, app.version, assignment())
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(ApplicationRefusal)
    expect((await item(h, app.id)).status).toBe("pending")
  })

  test("a missing cohort group writes nothing, alerts the admins once a day, then refuses", async () => {
    const h = await setup()
    const app = await seed(h)
    const missing = assignment({ cohort: 117 })
    expect(
      await code(h.service.accept(ACCOUNTS, app.id, app.version, missing))
    ).toBe("cohort_group_missing")
    expect((await item(h, app.id)).status).toBe("pending")
    expect(mails(h).map((m) => [m.mail.kind, m.mail.to])).toEqual(
      ADMIN_EMAILS.map((to) => ["cohort_missing", to])
    )
    expect(mails(h)[0].mail.text).toContain("/lab-member/117")
    expect(mails(h)[0].applicationId).toBeNull()

    // Same year again within a day: refused, no new mail.
    h.clock.advance(HOUR)
    expect(
      await code(h.service.accept(ACCOUNTS, app.id, app.version, missing))
    ).toBe("cohort_group_missing")
    expect(mails(h)).toHaveLength(2)

    // Another year has its own alert.
    expect(
      await code(
        h.service.accept(
          ACCOUNTS,
          app.id,
          app.version,
          assignment({ cohort: 118 })
        )
      )
    ).toBe("cohort_group_missing")
    expect(mails(h)).toHaveLength(4)

    // After 24 hours the first year alerts again.
    h.clock.advance(DAY)
    await code(h.service.accept(ACCOUNTS, app.id, app.version, missing))
    expect(mails(h)).toHaveLength(6)

    // Once the group exists, it goes through.
    h.keycloak.addGroup("/lab-member/117")
    await h.service.accept(ACCOUNTS, app.id, app.version, missing)
    expect((await item(h, app.id)).status).toBe("provisioning")
  })

  test("a rejected or withdrawn application cannot be accepted", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.service.reject(ACCOUNTS, app.id)
    expect(
      await code(
        h.service.accept(ACCOUNTS, app.id, app.version + 1, assignment())
      )
    ).toBe("wrong_state")
  })
})

describe("retryProvisioning", () => {
  async function provisioning(h: H) {
    const app = await seed(h)
    await h.service.accept(ACCOUNTS, app.id, app.version, assignment())
    return app
  }
  const block = (
    h: H,
    id: string,
    done: readonly (typeof STEP_NAMES)[number][]
  ) =>
    h.store.transaction(async (uow) => {
      let run = (await uow.lockRun(id))!
      for (const step of done) run = run.complete(step, h.clock.now())
      await uow.saveRun(
        run.fail(
          { blocked: true, reason: "boom" },
          new RetryPolicy({ maxAttempts: 1 }),
          h.clock.now()
        )
      )
    })

  test("clears the block and wakes the run", async () => {
    const h = await setup()
    const app = await provisioning(h)
    await block(h, app.id, [])
    h.clock.advance(HOUR)
    expect((await item(h, app.id)).provisioning?.blockedAt).not.toBeNull()
    expect(await h.service.retryProvisioning(ACCOUNTS, app.id)).toEqual({
      ok: true,
    })
    const view = await item(h, app.id)
    expect(view.provisioning).toMatchObject({
      blockedAt: null,
      error: null,
      attempts: 0,
      nextAt: h.clock.now().toISOString(),
    })
    expect(view.events.map((e) => e.kind)).toContain("provision_retried")
  })

  test("a new username or cohort is reassigned before the step that used it", async () => {
    const h = await setup()
    const app = await provisioning(h)
    await block(h, app.id, [])
    h.keycloak.addGroup("/lab-member/117")
    await h.service.retryProvisioning(ACCOUNTS, app.id, {
      username: "newname1",
      cohort: 117,
    })
    const view = await item(h, app.id)
    expect(view.assignment).toMatchObject({ username: "newname1", cohort: 117 })
    expect(view.status).toBe("provisioning")
    expect(view.version).toBeGreaterThan(app.version + 1)
  })

  test("a step already done keeps its value", async () => {
    const h = await setup()
    const app = await provisioning(h)
    await block(h, app.id, ["create_account"])
    expect(
      (
        await refusal(
          h.service.retryProvisioning(ACCOUNTS, app.id, { username: "other11" })
        )
      ).field
    ).toBe("username")
    await block(h, app.id, ["join_keycloak_groups"])
    expect(
      (
        await refusal(
          h.service.retryProvisioning(ACCOUNTS, app.id, { cohort: 117 })
        )
      ).field
    ).toBe("cohort")
  })

  describe("a changed value is checked first, as accept does", () => {
    const state = async (h: H, id: string) => {
      const v = await item(h, id)
      return [v.assignment?.username, v.assignment?.cohort, v.version]
    }

    test("a username Keycloak has is refused and nothing is written", async () => {
      const h = await setup()
      const app = await provisioning(h)
      await block(h, app.id, [])
      await h.keycloak.createUser({
        username: "inuse111",
        email: "x@example.com",
        firstName: "A",
        lastName: "B",
        attributes: {},
        groups: [],
      })
      const before = await state(h, app.id)
      expect(
        await code(
          h.service.retryProvisioning(ACCOUNTS, app.id, {
            username: "inuse111",
          })
        )
      ).toBe("username_unavailable")
      expect(await state(h, app.id)).toEqual(before)
    })

    test("a username another application is provisioning as is refused", async () => {
      const h = await setup()
      const app = await provisioning(h)
      await block(h, app.id, [])
      const other = await seed(h)
      await h.service.accept(
        ACCOUNTS,
        other.id,
        other.version,
        assignment({ username: "claimed2" })
      )
      expect(
        await code(
          h.service.retryProvisioning(ACCOUNTS, app.id, {
            username: "claimed2",
          })
        )
      ).toBe("username_unavailable")
    })

    test("Keycloak being down is a plain error, not a retry", async () => {
      const h = await setup()
      const app = await provisioning(h)
      await block(h, app.id, [])
      h.keycloak.fail("usernamesTaken")
      const error = await h.service
        .retryProvisioning(ACCOUNTS, app.id, { username: "newname2" })
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(ApplicationRefusal)
    })

    test("a missing cohort group is refused and alerts the admins once a day", async () => {
      const h = await setup()
      const app = await provisioning(h)
      await block(h, app.id, [])
      const before = await state(h, app.id)
      const sent = mails(h).length
      for (let i = 0; i < 2; i++)
        expect(
          await code(
            h.service.retryProvisioning(ACCOUNTS, app.id, { cohort: 117 })
          )
        ).toBe("cohort_group_missing")
      expect(
        mails(h)
          .slice(sent)
          .map((m) => m.mail.kind)
      ).toEqual(ADMIN_EMAILS.map(() => "cohort_missing"))
      expect(await state(h, app.id)).toEqual(before)
    })

    test("unchanged values ask Keycloak nothing", async () => {
      const h = await setup()
      const app = await provisioning(h)
      await block(h, app.id, [])
      h.keycloak.fail("usernamesTaken", 5)
      h.keycloak.fail("groupExists", 5)
      expect(
        await h.service.retryProvisioning(ACCOUNTS, app.id, {
          username: "xmwang",
          cohort: 116,
        })
      ).toEqual({ ok: true })
    })
  })

  test("only a provisioning application can be retried", async () => {
    const h = await setup()
    const app = await seed(h)
    expect(await code(h.service.retryProvisioning(ACCOUNTS, app.id))).toBe(
      "wrong_state"
    )
    const done = await accepted(h)
    expect(await code(h.service.retryProvisioning(ACCOUNTS, done.id))).toBe(
      "wrong_state"
    )
  })
})

describe("reject", () => {
  test("closes the application and mails the applicant, with the note when given", async () => {
    const h = await setup()
    const a = await seed(h)
    const b = await seed(h)
    expect(await h.service.reject(ACCOUNTS, a.id, "名額已滿")).toEqual({
      ok: true,
    })
    expect(await h.service.reject(ACCOUNTS, b.id)).toEqual({ ok: true })
    const [mailA, mailB] = mails(h)
    expect([mailA.mail.kind, mailA.mail.to]).toEqual([
      "rejected",
      a.email!.value,
    ])
    expect(mailA.mail.text).toContain("名額已滿")
    expect(mailB.mail.text).not.toContain("審核的人留了這段話")
    const view = await item(h, a.id, true)
    expect(view.status).toBe("rejected")
    expect(view.reviewNote).toBe("名額已滿")
    expect(view.events.map((e) => [e.kind, e.actorId])).toEqual([
      ["rejected", ACCOUNTS],
    ])
  })

  test("rejecting a change request closes it", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.service.requestChanges(ACCOUNTS, app.id, app.version, "fix it")
    await h.service.reject(ACCOUNTS, app.id)
    const view = await item(h, app.id, true)
    expect(view.status).toBe("rejected")
    expect(view.changeRequest).toBeNull()
  })

  test("rejecting twice sends one mail; after acceptance it is refused", async () => {
    const h = await setup()
    const app = await seed(h)
    await h.service.reject(ACCOUNTS, app.id)
    await h.service.reject(ACCOUNTS, app.id, "again")
    expect(kinds(h)).toEqual(["rejected"])
    const other = await seed(h)
    await h.service.accept(ACCOUNTS, other.id, other.version, assignment())
    expect(await code(h.service.reject(ACCOUNTS, other.id))).toBe("wrong_state")
  })

  test("a failing queue keeps the application open", async () => {
    let fail = false
    const h = await setup({
      wrap: (inner) => ({
        reader: inner.reader,
        transaction: (work) =>
          inner.transaction((uow) =>
            work({
              ...uow,
              queueMail: async (id, mail) => {
                if (fail) throw new Error("outbox down")
                return uow.queueMail(id, mail)
              },
            } as UnitOfWork)
          ),
      }),
    })
    const app = await seed(h)
    fail = true
    await expect(h.service.reject(ACCOUNTS, app.id)).rejects.toThrow(
      "outbox down"
    )
    expect((await item(h, app.id)).status).toBe("pending")
  })
})

describe("resendPasswordMail", () => {
  test("asks the worker for a mail as the admin, once an hour", async () => {
    const h = await setup()
    const app = await accepted(h)
    expect(await h.service.resendPasswordMail(ACCOUNTS, app.id)).toEqual({
      ok: true,
    })
    const view = await item(h, app.id)
    expect(
      view.events.filter((e) => e.kind === "password_mail_requested")
    ).toMatchObject([{ actorKind: "admin", actorId: ACCOUNTS }])
    expect(view.passwordMail?.canResend).toBe(false)
    expect(await code(h.service.resendPasswordMail(ACCOUNTS, app.id))).toBe(
      "rate_limited"
    )
    h.clock.advance(HOUR)
    await h.service.resendPasswordMail(ACCOUNTS, app.id)
  })

  test("shares the hourly limit with the applicant's own request", async () => {
    const h = await setup()
    const app = await accepted(h)
    await h.store.transaction((uow) =>
      uow.appendEvent(
        app.id,
        "password_mail_requested",
        null,
        { kind: "applicant" },
        h.clock.now()
      )
    )
    expect(await code(h.service.resendPasswordMail(ACCOUNTS, app.id))).toBe(
      "rate_limited"
    )
  })

  test("a released account and a not yet accepted application are refused", async () => {
    const h = await setup()
    const app = await accepted(h)
    await h.store.transaction(async (uow) => {
      await uow.saveRun((await uow.lockRun(app.id))!.release(h.clock.now()))
    })
    expect(await code(h.service.resendPasswordMail(ACCOUNTS, app.id))).toBe(
      "password_already_set"
    )
    const waiting = await seed(h)
    expect(await code(h.service.resendPasswordMail(ACCOUNTS, waiting.id))).toBe(
      "wrong_state"
    )
  })
})
