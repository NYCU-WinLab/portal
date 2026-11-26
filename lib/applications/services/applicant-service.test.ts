import { describe, expect, test } from "bun:test"
import { STEP_NAMES } from "../domain/constants"
import { MailRatePolicy, RetentionPolicy } from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import { APPLICANT_CODES, ApplicationRefusal } from "../domain/refusal"
import { Application } from "../domain/application"
import { Email } from "../domain/values"
import type { ApplicationStore, UnitOfWork } from "../ports"
import { FixedClock } from "../testing/clock"
import { FakeKeycloak } from "../testing/fake-keycloak"
import { FakeAuthority, FixedReservedNames } from "../testing/fakes"
import {
  ADMIN,
  assignment,
  pending,
  profile,
  profileInput,
} from "../testing/fixtures"
import {
  InMemoryApplicationStore,
  InMemorySettingsStore,
} from "../testing/memory-store"
import { SequentialTokens } from "../testing/tokens"
import { ApplicantService, type SubmitForm } from "./applicant-service"
import { MailComposer } from "./mail-composer"

// The mail footer reads this; pin it so mails do not depend on the env.
process.env.BETTER_AUTH_URL = "https://portal.example.test"

const HOUR = 3_600_000
const DAY = 24 * HOUR
const EMAIL = "applicant@example.com"
const PROCESSOR = "processor@example.com"

const APPLY_SITE = "https://apply.example.test"
const SETTER = "00000000-0000-4000-8000-0000000000a1"

type Setup = {
  /** Leave the apply site's address unset. */
  noApplySite?: boolean
  wrap?: (store: InMemoryApplicationStore) => ApplicationStore
  authority?: FakeAuthority
}

async function setup(opts: Setup = {}) {
  const store = await InMemoryApplicationStore.create()
  const keycloak = new FakeKeycloak()
  const authority =
    opts.authority ?? new FakeAuthority({ processorEmails: [PROCESSOR] })
  const settings = new InMemorySettingsStore({
    [SETTER]: { name: "王小明", email: "xmwang@winlab.tw" },
  })
  await settings.setApplySite(APPLY_SITE, SETTER, new Date())
  // Lets a test take the address away after the application exists.
  const site = { set: !opts.noApplySite, inTransaction: false }
  const visible: InMemorySettingsStore = Object.create(settings, {
    applySite: {
      value: async () => {
        // A read inside a transaction would take a second pooled connection
        // while the mail-limit lock is held.
        if (site.inTransaction)
          throw new Error("settings read inside a transaction")
        return site.set
          ? settings.applySite()
          : { url: null, updatedAt: null, updatedBy: null }
      },
    },
  })
  const tracked: ApplicationStore = {
    get reader() {
      return store.reader
    },
    transaction: async (work) => {
      site.inTransaction = true
      try {
        return await store.transaction(work)
      } finally {
        site.inTransaction = false
      }
    },
  }
  const clock = new FixedClock()
  const retention = new RetentionPolicy()
  let ids = 0
  const service = new ApplicantService({
    store: opts.wrap ? opts.wrap(store) : tracked,
    directory: keycloak,
    authority,
    settings: visible,
    reserved: new FixedReservedNames(["root"]),
    mail: new MailComposer({ siteUrl: "https://portal.example.test" }),
    tokens: new SequentialTokens(),
    retention,
    rate: new MailRatePolicy(),
    clock,
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  })
  return {
    store,
    keycloak,
    authority,
    settings,
    site,
    clock,
    retention,
    service,
  }
}
type H = Awaited<ReturnType<typeof setup>>

const form = (
  email = EMAIL,
  profile: Record<string, unknown> = {}
): SubmitForm => ({
  email,
  requestedStatus: "master",
  profile: { ...profileInput(), ...profile },
})

const mails = (h: H) => h.store.outbox()
const kinds = (h: H) => mails(h).map((m) => m.mail.kind)

function tokenIn(text: string, path: "confirm" | "status"): string {
  const m = new RegExp(`/${path}/([A-Za-z0-9_-]+)`).exec(text)
  if (!m) throw new Error(`no ${path} link in mail`)
  return m[1]
}

/** The token of the newest mail of this kind. */
function lastToken(h: H, kind: "verify" | "link" | "received"): string {
  const mail = mails(h)
    .filter((m) => m.mail.kind === kind)
    .at(-1)
  if (!mail) throw new Error(`no ${kind} mail`)
  return tokenIn(mail.mail.text, kind === "verify" ? "confirm" : "status")
}

async function refused(p: Promise<unknown>): Promise<string> {
  const error = await p.then(
    () => {
      throw new Error("expected a refusal")
    },
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ApplicationRefusal)
  const r = error as ApplicationRefusal
  expect(APPLICANT_CODES).toContain(r.code)
  return r.message
}

async function submitted(h: H, email = EMAIL): Promise<string> {
  await h.service.submit(form(email))
  return lastToken(h, "verify")
}

/** Submitted and confirmed; returns the access token and the id. */
async function confirmed(h: H, email = EMAIL) {
  const verify = await submitted(h, email)
  await h.service.confirm(verify)
  const received = mails(h)
    .filter((m) => m.mail.kind === "received")
    .at(-1)!
  return {
    access: tokenIn(received.mail.text, "status"),
    id: received.applicationId!,
  }
}

async function accept(h: H, id: string) {
  const now = h.clock.now()
  await h.store.transaction(async (uow) => {
    const app = (await uow.lock(id))!
    const t = app.accept(assignment(), app.version, ADMIN, now)
    if (t.kind !== "changed") throw new Error("not accepted")
    await uow.save(t)
    await uow.setKeycloakId(id, crypto.randomUUID())
    const finished = (await uow.lock(id))!.finish(now)
    if (finished.kind !== "changed") throw new Error("not finished")
    await uow.save(finished)
    await uow.saveRun(
      ProvisioningRun.restore({
        applicationId: id,
        attempts: 0,
        nextAt: now,
        error: null,
        blockedAt: null,
        startedAt: now,
        finishedAt: now,
        releasedAt: null,
        completed: STEP_NAMES.map((step) => ({ step, at: now })),
      })
    )
  })
}

async function release(h: H, id: string) {
  await h.store.transaction(async (uow) => {
    const run = (await uow.lockRun(id))!
    await uow.saveRun(run.release(h.clock.now()))
  })
}

async function requestChanges(h: H, id: string) {
  const now = h.clock.now()
  await h.store.transaction(async (uow) => {
    const app = (await uow.lock(id))!
    const t = app.requestChanges(
      { note: "學號打錯了", dueAt: h.retention.changesDue(now) },
      app.version,
      ADMIN,
      now
    )
    if (t.kind !== "changed") throw new Error("not changed")
    await uow.save(t)
  })
}

describe("the apply site's address", () => {
  test("mail links use the address as set, and follow a change", async () => {
    const h = await setup()
    await h.service.submit(form())
    expect(mails(h)[0].mail.text).toContain(`${APPLY_SITE}/confirm/`)
    await h.settings.setApplySite(
      "https://apply2.winlab.tw",
      SETTER,
      h.clock.now()
    )
    h.clock.advance(HOUR + 1)
    await h.service.submit(form())
    expect(mails(h).at(-1)!.mail.text).toContain(
      "https://apply2.winlab.tw/confirm/"
    )
  })

  test("an unset address fails the same for a new and an applied email", async () => {
    const outcome = async (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: unknown) =>
          `${(e as Error).constructor.name}:${(e as Error).message}`
      )
    const h = await setup()
    await confirmed(h, "applied@example.com")
    h.site.set = false
    h.clock.advance(HOUR + 1)
    const results = [
      await outcome(h.service.submit(form("new@example.com"))),
      await outcome(h.service.submit(form("applied@example.com"))),
      await outcome(h.service.sendLink("new2@example.com")),
      await outcome(h.service.sendLink("applied@example.com")),
    ]
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe("Error:申請網站網址尚未設定")
    // An account holder gets no apply link, but fails the same way.
    await h.keycloak.createUser({
      username: "someone",
      email: "acct@example.com",
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    expect(await outcome(h.service.submit(form("acct@example.com")))).toBe(
      results[0]
    )
  })

  test("a missing address is a plain error for each mail that needs it", async () => {
    const plainError = async (p: Promise<unknown>) => {
      const error = await p.then(
        () => {
          throw new Error("expected an error")
        },
        (e: unknown) => e
      )
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(ApplicationRefusal)
      expect((error as Error).message).toBe("申請網站網址尚未設定")
    }

    // verify
    const fresh = await setup({ noApplySite: true })
    await plainError(fresh.service.submit(form()))
    expect(mails(fresh)).toEqual([])

    // received, on confirm
    const h = await setup()
    const verify = await submitted(h)
    h.site.set = false
    await plainError(h.service.confirm(verify))

    // link, on a second submit and on sendLink
    h.site.set = true
    await h.service.confirm(verify)
    h.site.set = false
    h.clock.advance(HOUR + 1)
    await plainError(h.service.submit(form()))
    h.clock.advance(HOUR + 1)
    await plainError(h.service.sendLink(EMAIL))
  })
})

describe("submit", () => {
  test("the three cases return the same and send the right mail", async () => {
    const fresh = await setup()
    const a = await fresh.service.submit(form())
    expect(kinds(fresh)).toEqual(["verify"])

    const active = await setup()
    await confirmed(active)
    active.clock.advance(HOUR + 1)
    const before = mails(active).length
    const b = await active.service.submit(form())
    expect(
      mails(active)
        .slice(before)
        .map((m) => m.mail.kind)
    ).toEqual(["link"])

    const account = await setup()
    await account.keycloak.createUser({
      username: "someone",
      email: EMAIL,
      firstName: "A",
      lastName: "B",
      attributes: {},
      groups: [],
    })
    const c = await account.service.submit(form())
    expect(mails(account)).toEqual([
      expect.objectContaining({ applicationId: null }),
    ])
    expect(kinds(account)).toEqual(["has_account"])

    expect(a).toEqual({ ok: true })
    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  test("the link mail for an active application carries a new access token", async () => {
    const h = await setup()
    const { access } = await confirmed(h)
    h.clock.advance(HOUR + 1)
    await h.service.submit(form())
    const fresh = lastToken(h, "link")
    expect(fresh).not.toBe(access)
    expect((await h.service.getStatus(fresh)).status).toBe("pending")
    await refused(h.service.getStatus(access))
  })

  test("a second submit overwrites the unverified one; the old token dies", async () => {
    const h = await setup()
    const first = await submitted(h)
    h.clock.advance(HOUR + 1)
    await h.service.submit(form(EMAIL, { chineseName: "王大明" }))
    const second = lastToken(h, "verify")
    expect(second).not.toBe(first)
    expect(await refused(h.service.getForConfirm(first))).toBe("link_invalid")
    expect((await h.service.getForConfirm(second)).chineseName).toBe("王大明")
    expect(kinds(h)).toEqual(["verify"])
    // The 24 hours restart from the second submit.
    h.clock.advance(DAY - HOUR)
    expect((await h.service.confirm(second)).ok).toBe(true)
  })

  test("refuses invalid input by field before writing anything", async () => {
    const h = await setup()
    expect(await refused(h.service.submit(form("nope")))).toBe(
      "invalid_input:email"
    )
    expect(
      await refused(h.service.submit(form(EMAIL, { username: "root" })))
    ).toBe("invalid_input:username")
    expect(await refused(h.service.submit(form(EMAIL, { phone: 12 })))).toBe(
      "invalid_input:phone"
    )
    expect(
      await refused(
        h.service.submit({ ...form(), requestedStatus: "professor" })
      )
    ).toBe("invalid_input:requested_status")
    expect(mails(h)).toEqual([])
  })

  test("a second mail to the same recipient within an hour is rate limited", async () => {
    const h = await setup()
    await h.service.submit(form())
    expect(await refused(h.service.submit(form()))).toBe("rate_limited")
    expect(kinds(h)).toEqual(["verify"])
  })

  test("Keycloak being down reaches the caller as is", async () => {
    const h = await setup()
    h.keycloak.fail("emailExists")
    await expect(h.service.submit(form())).rejects.toThrow("unavailable")
  })
})

describe("getForConfirm", () => {
  test("shows the summary with the last three digits of the phone", async () => {
    const h = await setup()
    const token = await submitted(h)
    const view = await h.service.getForConfirm(token)
    expect(view).toEqual({
      chineseName: "王小明",
      firstName: "Xiao-Ming",
      lastName: "Wang",
      studentId: "312551000",
      department: "資工",
      requestedStatus: "master",
      username: "xmwang",
      phoneLast3: "678",
      confirmed: false,
    })
    await h.service.confirm(token)
    expect((await h.service.getForConfirm(token)).confirmed).toBe(true)
  })

  test("an unknown or expired token is link_invalid", async () => {
    const h = await setup()
    const token = await submitted(h)
    expect(await refused(h.service.getForConfirm("x".repeat(24)))).toBe(
      "link_invalid"
    )
    h.clock.advance(DAY)
    expect(await refused(h.service.getForConfirm(token))).toBe("link_invalid")
  })
})

describe("confirm", () => {
  test("confirming twice sends one received mail and notifies processors once", async () => {
    const h = await setup()
    const token = await submitted(h)
    expect(await h.service.confirm(token)).toEqual({ ok: true, already: false })
    expect(await h.service.confirm(token)).toEqual({ ok: true, already: true })
    expect(kinds(h)).toEqual(["verify", "received", "processor_notice"])
    expect(mails(h)[2].mail.to).toBe(PROCESSOR)
  })

  test("an expired verify token is link_invalid", async () => {
    const h = await setup()
    const token = await submitted(h)
    h.clock.advance(DAY)
    expect(await refused(h.service.confirm(token))).toBe("link_invalid")
  })

  test("already_applied mails the active one and drops the unverified one", async () => {
    const h = await setup()
    const token = await submitted(h)
    const active = await pending(h.clock.now(), { email: Email.parse(EMAIL) })
    await h.store.transaction(async (uow) => {
      await uow.save({
        kind: "changed",
        previous: null,
        next: active,
        events: [],
        at: h.clock.now(),
      })
    })
    expect(await h.service.confirm(token)).toEqual({
      ok: false,
      code: "already_applied",
    })
    expect(mails(h).map((m) => [m.mail.kind, m.applicationId])).toEqual([
      ["link", active.id],
    ])
    expect(await refused(h.service.getForConfirm(token))).toBe("link_invalid")
    expect((await h.service.getStatus(lastToken(h, "link"))).status).toBe(
      "pending"
    )
  })

  test("active_email_taken from save takes the same path", async () => {
    let firstLookup = true
    const wrap = (inner: InMemoryApplicationStore): ApplicationStore => ({
      reader: inner.reader,
      transaction: (work) =>
        inner.transaction((uow) => {
          const racing: UnitOfWork = {
            ...uow,
            lockByEmail: async (email, statuses) => {
              if (firstLookup && statuses.includes("pending")) {
                firstLookup = false
                return null
              }
              return uow.lockByEmail(email, statuses)
            },
          }
          return work(racing)
        }),
    })
    const h = await setup({ wrap })
    const token = await submitted(h)
    firstLookup = true
    const active = await pending(h.clock.now(), { email: Email.parse(EMAIL) })
    await h.store.transaction((uow) =>
      uow.save({
        kind: "changed",
        previous: null,
        next: active,
        events: [],
        at: h.clock.now(),
      })
    )
    expect(await h.service.confirm(token)).toEqual({
      ok: false,
      code: "already_applied",
    })
    expect(firstLookup).toBe(false)
    expect(mails(h).map((m) => [m.mail.kind, m.applicationId])).toEqual([
      ["link", active.id],
    ])
  })

  test("an error mid-transaction leaves no mail in the outbox", async () => {
    const authority = new FakeAuthority()
    authority.processorEmails = async () => {
      throw new Error("directory down")
    }
    const h = await setup({ authority })
    const token = await submitted(h)
    await expect(h.service.confirm(token)).rejects.toThrow("directory down")
    expect(kinds(h)).toEqual(["verify"])
    expect((await h.service.getForConfirm(token)).confirmed).toBe(false)
  })
})

describe("getStatus", () => {
  test("shows the state without personal data", async () => {
    const h = await setup()
    const { access } = await confirmed(h)
    const view = await h.service.getStatus(access)
    expect(view).toEqual({
      status: "pending",
      submittedAt: h.clock.now().toISOString(),
      verifiedAt: h.clock.now().toISOString(),
      reviewedAt: null,
      closedAt: null,
      changeRequest: null,
      closure: null,
      passwordMail: null,
    })
    expect(JSON.stringify(view)).not.toContain("王小明")
  })

  test("accepted without a password never expires; released, 30 days", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    await accept(h, id)
    h.clock.advance(60 * DAY)
    const view = await h.service.getStatus(access)
    expect(view.status).toBe("accepted")
    expect(view.passwordMail).toEqual({
      lastSentAt: null,
      expiresAt: null,
      passwordSet: false,
      canResend: true,
    })
    await release(h, id)
    h.clock.advance(30 * DAY - 1)
    expect((await h.service.getStatus(access)).passwordMail?.passwordSet).toBe(
      true
    )
    h.clock.advance(1)
    expect(await refused(h.service.getStatus(access))).toBe("link_invalid")
  })

  test("a withdrawn application's link lasts 30 days", async () => {
    const h = await setup()
    const { access } = await confirmed(h)
    await h.service.withdraw(access)
    const view = await h.service.getStatus(access)
    expect(view.closure).toEqual({ kind: "withdrawn" })
    h.clock.advance(30 * DAY)
    expect(await refused(h.service.getStatus(access))).toBe("link_invalid")
  })

  test("a verify token is not an access token", async () => {
    const h = await setup()
    const verify = await submitted(h)
    await h.service.confirm(verify)
    expect(await refused(h.service.getStatus(verify))).toBe("link_invalid")
  })
})

describe("sendLink", () => {
  test("mails a fresh link for an active application", async () => {
    const h = await setup()
    const { access } = await confirmed(h)
    h.clock.advance(HOUR + 1)
    expect(await h.service.sendLink(EMAIL)).toEqual({ ok: true })
    const fresh = lastToken(h, "link")
    expect(fresh).not.toBe(access)
    expect((await h.service.getStatus(fresh)).status).toBe("pending")
  })

  test("rate limited or unknown: ok and no mail", async () => {
    const h = await setup()
    await confirmed(h)
    const before = kinds(h)
    expect(await h.service.sendLink(EMAIL)).toEqual({ ok: true })
    expect(kinds(h)).toEqual(before)
    expect(await h.service.sendLink("nobody@example.com")).toEqual({
      ok: true,
    })
    expect(kinds(h)).toEqual(before)
  })

  test("an invalid email is invalid_input", async () => {
    const h = await setup()
    expect(await refused(h.service.sendLink("nope"))).toBe(
      "invalid_input:email"
    )
  })

  test("a closed application past its access window gets no mail", async () => {
    const h = await setup()
    const { access } = await confirmed(h)
    await h.service.withdraw(access)
    h.clock.advance(30 * DAY)
    const before = kinds(h)
    expect(await h.service.sendLink(EMAIL)).toEqual({ ok: true })
    expect(kinds(h)).toEqual(before)
  })

  test("an accepted application without a password still gets its link", async () => {
    const h = await setup()
    const { id } = await confirmed(h)
    await accept(h, id)
    h.clock.advance(60 * DAY)
    await h.service.sendLink(EMAIL)
    expect((await h.service.getStatus(lastToken(h, "link"))).status).toBe(
      "accepted"
    )
  })
})

describe("withdraw", () => {
  test("withdraws once and answers the same the second time", async () => {
    const h = await setup()
    const { access } = await confirmed(h)
    expect(await h.service.withdraw(access)).toEqual({
      ok: true,
      status: "withdrawn",
    })
    expect(await h.service.withdraw(access)).toEqual({
      ok: true,
      status: "withdrawn",
    })
    expect((await h.service.getStatus(access)).status).toBe("withdrawn")
  })

  test("an accepted application cannot be withdrawn", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    await accept(h, id)
    expect(await refused(h.service.withdraw(access))).toBe("wrong_state")
  })
})

describe("getForEdit and resubmit", () => {
  test("edit only while changes are requested and not due", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    expect(await refused(h.service.getForEdit(access))).toBe("wrong_state")
    await requestChanges(h, id)
    const view = await h.service.getForEdit(access)
    expect(view.profile.chineseName).toBe("王小明")
    expect(view.requestedStatus).toBe("master")
    expect(view.changeRequest).toEqual({
      note: "學號打錯了",
      dueAt: h.retention.changesDue(h.clock.now()).toISOString(),
      expired: false,
    })
    h.clock.advance(7 * DAY)
    expect(await refused(h.service.getForEdit(access))).toBe(
      "edit_window_closed"
    )
  })

  test("resubmit saves the profile and notifies processors", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    await requestChanges(h, id)
    const before = mails(h).length
    const result = await h.service.resubmit(access, {
      requestedStatus: "doctoral",
      profile: { ...profileInput(), studentId: "312551999" },
    })
    expect(result).toEqual({ ok: true, version: 4 })
    expect(
      mails(h)
        .slice(before)
        .map((m) => [m.mail.kind, m.mail.to])
    ).toEqual([["processor_notice", PROCESSOR]])
    const status = await h.service.getStatus(access)
    expect(status.status).toBe("pending")
    expect(status.changeRequest).toBeNull()
    expect(h.store.events(id).at(-1)?.changes).toEqual({
      student_id: { from: "312551000", to: "312551999" },
      requested_status: { from: "master", to: "doctoral" },
    })
  })

  test("resubmit after the due date is edit_window_closed; bad input by field", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    await requestChanges(h, id)
    expect(
      await refused(
        h.service.resubmit(access, {
          requestedStatus: "master",
          profile: { ...profileInput(), birthday: "2027-02-30" },
        })
      )
    ).toBe("invalid_input:birthday")
    h.clock.advance(7 * DAY)
    expect(
      await refused(
        h.service.resubmit(access, {
          requestedStatus: "master",
          profile: profileInput(),
        })
      )
    ).toBe("edit_window_closed")
  })
})

describe("requestPasswordMail", () => {
  test("records the request and wakes the run; twice within an hour is rate_limited", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    await accept(h, id)
    h.clock.advance(HOUR)
    expect(await h.service.requestPasswordMail(access)).toEqual({ ok: true })
    expect(h.store.events(id).at(-1)).toMatchObject({
      kind: "password_mail_requested",
      actor: { kind: "applicant" },
    })
    const state = await h.store.reader.passwordMail(id)
    expect(state.pendingRequest).toEqual({ kind: "applicant" })
    await h.store.transaction(async (uow) => {
      expect((await uow.lockRun(id))!.nextAt).toEqual(h.clock.now())
    })
    h.clock.advance(HOUR - 1)
    expect(await refused(h.service.requestPasswordMail(access))).toBe(
      "rate_limited"
    )
    h.clock.advance(1)
    expect(await h.service.requestPasswordMail(access)).toEqual({ ok: true })
  })

  test("a processor's request counts toward the hour", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    await accept(h, id)
    await h.store.transaction((uow) =>
      uow.appendEvent(id, "password_mail_requested", null, ADMIN, h.clock.now())
    )
    expect(await refused(h.service.requestPasswordMail(access))).toBe(
      "rate_limited"
    )
  })

  test("after release it is password_already_set; before acceptance wrong_state", async () => {
    const h = await setup()
    const { access, id } = await confirmed(h)
    expect(await refused(h.service.requestPasswordMail(access))).toBe(
      "wrong_state"
    )
    await accept(h, id)
    await release(h, id)
    expect(await refused(h.service.requestPasswordMail(access))).toBe(
      "password_already_set"
    )
  })
})

/** Wraps the memory store; `uow` gets the store's unit of work per call. */
function wrapUow(
  change: (uow: UnitOfWork) => Partial<UnitOfWork>
): (inner: InMemoryApplicationStore) => ApplicationStore {
  return (inner) => ({
    reader: inner.reader,
    transaction: (work) =>
      inner.transaction((uow) => work({ ...uow, ...change(uow) })),
  })
}

describe("races the indexes catch", () => {
  test("username_claimed from save is invalid_input:username and queues no mail", async () => {
    let claimed = false
    const h = await setup({
      wrap: wrapUow((uow) => ({
        save: async (t) => (claimed ? "username_claimed" : uow.save(t)),
      })),
    })
    claimed = true
    const error = await h.service.submit(form()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApplicationRefusal)
    expect((error as ApplicationRefusal).code).toBe("invalid_input")
    expect((error as ApplicationRefusal).field).toBe("username")
    expect(mails(h)).toEqual([])

    claimed = false
    const { access, id } = await confirmed(h)
    await requestChanges(h, id)
    const before = mails(h).length
    claimed = true
    expect(
      await refused(
        h.service.resubmit(access, {
          requestedStatus: "master",
          profile: profileInput(),
        })
      )
    ).toBe("invalid_input:username")
    expect(mails(h).length).toBe(before)
    claimed = false
    expect((await h.service.getStatus(access)).status).toBe("changes_requested")
  })

  test("a concurrent unverified submit is replaced once", async () => {
    const rival = Application.submit(
      {
        id: crypto.randomUUID(),
        email: Email.parse(EMAIL),
        requestedStatus: "master",
        profile: await profile({ username: "rival" }),
      },
      new Date(0)
    )
    let racing = true
    let hidden = false
    const h = await setup({
      wrap: wrapUow((uow) => ({
        // The rival commits just after this transaction looked: the first
        // lookup misses it and the save trips the unverified index.
        savepoint: async (work) => {
          if (racing) {
            racing = false
            hidden = true
            await uow.save(rival)
          }
          return uow.savepoint(work)
        },
        lockByEmail: async (email, statuses) => {
          if (hidden && statuses.includes("unverified")) {
            hidden = false
            return null
          }
          return uow.lockByEmail(email, statuses)
        },
      })),
    })
    expect(await h.service.submit(form())).toEqual({ ok: true })
    expect(racing).toBe(false)
    expect(hidden).toBe(false)
    expect(kinds(h)).toEqual(["verify"])
    const ours = mails(h)[0].applicationId!
    await h.store.transaction(async (uow) => {
      expect(await uow.lock(rival.next.id)).toBeNull()
      expect((await uow.lock(ours))?.status).toBe("unverified")
      expect(
        (await uow.lockByEmail(Email.parse(EMAIL), ["unverified"]))?.id
      ).toBe(ours)
    })
    expect(
      (await h.service.getForConfirm(lastToken(h, "verify"))).username
    ).toBe("xmwang")
  })
})

describe("lock order", () => {
  // submit and sendLink both reserve mail and lock rows. Postgres holds the
  // mail lock to commit, so both take it before any row lock or they can
  // deadlock on the same email.
  function recording() {
    const calls: string[] = []
    const wrap = wrapUow((uow) => {
      const out: Partial<UnitOfWork> = {}
      for (const [name, fn] of Object.entries(uow)) {
        if (typeof fn !== "function") continue
        ;(out as Record<string, unknown>)[name] = (...args: unknown[]) => {
          calls.push(name)
          return (fn as (...a: unknown[]) => unknown)(...args)
        }
      }
      return out
    })
    return { calls, wrap }
  }
  const firstLock = (calls: string[]) =>
    calls.findIndex((c) => c.startsWith("lock") && c !== "lockMailLimit")

  test("submit for an active application locks mail first", async () => {
    const r = recording()
    const h = await setup({ wrap: r.wrap })
    await confirmed(h)
    h.clock.advance(HOUR + 1)
    r.calls.length = 0
    expect(await h.service.submit(form())).toEqual({ ok: true })
    expect(r.calls[0]).toBe("lockMailLimit")
    expect(firstLock(r.calls)).toBeGreaterThan(0)
  })

  test("submit for a new email locks mail first", async () => {
    const r = recording()
    const h = await setup({ wrap: r.wrap })
    expect(await h.service.submit(form())).toEqual({ ok: true })
    expect(r.calls[0]).toBe("lockMailLimit")
  })

  test("sendLink locks mail first", async () => {
    const r = recording()
    const h = await setup({ wrap: r.wrap })
    await confirmed(h)
    h.clock.advance(HOUR + 1)
    r.calls.length = 0
    await h.service.sendLink(EMAIL)
    expect(r.calls[0]).toBe("lockMailLimit")
    expect(firstLock(r.calls)).toBeGreaterThan(0)
  })
})
