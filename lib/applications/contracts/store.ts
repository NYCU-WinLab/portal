import { describe, expect, test } from "bun:test"
import {
  APPLICANT,
  SYSTEM,
  type Application,
  type Changed,
  type Transition,
} from "../domain/application"
import { Application as App } from "../domain/application"
import type { ApplicationStatus, MailKind } from "../domain/constants"
import { MailRatePolicy, RetryPolicy } from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import { Email, Username } from "../domain/values"
import type { ApplicationStore, ComposedMail } from "../ports"
import { NOW, assignment, profile, submitInput } from "../testing/fixtures"
import { SequentialTokens } from "../testing/tokens"

export type StoreSubject = {
  store: ApplicationStore
  adminId: string
  queuedMails(): Promise<
    { applicationId: string | null; kind: MailKind; to: string }[]
  >
  changeRequestNotes(applicationId: string): Promise<(string | null)[]>
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const at = (ms: number) => new Date(NOW.getTime() + ms)
const retry = new RetryPolicy()

// keycloak_id is a uuid column; Keycloak ids are UUIDs.
const KC_A = "0b8c1f2e-6d3a-4c5b-9e7f-1a2b3c4d5e6f"
const KC_B = "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2918"
const KC_C = "c3d2e1f0-a9b8-4c7d-8e6f-504132231405"

function changed(t: Transition): Changed {
  if (t.kind !== "changed") throw new Error("expected a change")
  return t
}

function mail(kind: MailKind, to: string): ComposedMail {
  return { kind, to, subject: "subject", text: "text", html: "<p>html</p>" }
}

/** Saves the transition in its own transaction and expects "ok". */
async function saveOk(store: ApplicationStore, t: Transition) {
  const c = changed(t)
  const result = await store.transaction((uow) => uow.save(c))
  expect(result).toBe("ok")
  return c.next
}

async function lock(store: ApplicationStore, id: string) {
  return store.transaction((uow) => uow.lock(id))
}

/** Submits, saves, confirms and saves; returns the pending application. */
async function seedPending(
  store: ApplicationStore,
  opts: { email?: Email; at?: Date } = {}
): Promise<Application> {
  const when = opts.at ?? NOW
  const input = await submitInput(opts.email ? { email: opts.email } : {})
  const submitted = await saveOk(store, App.submit(input, when))
  return saveOk(store, submitted.confirm(when))
}

/** A pending application accepted with `username` and saved. */
async function seedProvisioning(
  s: StoreSubject,
  username: string,
  opts: { mailGroups?: string[]; at?: Date } = {}
): Promise<Application> {
  const when = opts.at ?? NOW
  const a = await seedPending(s.store, { at: when })
  return saveOk(
    s.store,
    a.accept(
      assignment({
        username: Username.restore(username),
        mailGroups: opts.mailGroups ?? [],
      }),
      a.version,
      { kind: "admin", id: s.adminId },
      when
    )
  )
}

async function saveRun(store: ApplicationStore, run: ProvisioningRun) {
  await store.transaction((uow) => uow.saveRun(run))
}

const ALL_STEPS = [
  "create_account",
  "join_keycloak_groups",
  "join_mail_groups",
  "activate_and_mail",
  "finish",
] as const

function completeAll(run: ProvisioningRun, when: Date): ProvisioningRun {
  return ALL_STEPS.reduce((r, step) => r.complete(step, when), run)
}

/** Event kinds of an open (not unverified) application, in id order. */
async function eventKinds(store: ApplicationStore, id: string) {
  const rows = await store.reader.list({ closed: false })
  return rows.find((r) => r.application.id === id)?.events.map((e) => e.kind)
}

/** Behaviour every ApplicationStore (in memory or Postgres) must share. */
export function applicationStoreContract(
  make: (opts: { rate: MailRatePolicy }) => Promise<StoreSubject>
) {
  const subject = (rate = new MailRatePolicy()) => make({ rate })

  describe("application store contract", () => {
    test("save then lock restores the same application", async () => {
      const s = await subject()
      const admin = { kind: "admin" as const, id: s.adminId }
      const a = await seedPending(s.store)
      expect((await lock(s.store, a.id))?.snapshot).toEqual(a.snapshot)

      const requested = await saveOk(
        s.store,
        a.requestChanges(
          { note: "請補學號", dueAt: at(7 * DAY) },
          a.version,
          admin,
          at(HOUR)
        )
      )
      expect(requested.profile).not.toBeNull()
      expect(requested.changeRequest).not.toBeNull()
      expect((await lock(s.store, a.id))?.snapshot).toEqual(requested.snapshot)

      const resubmitted = await saveOk(
        s.store,
        requested.resubmit(
          {
            profile: await profile({ chineseName: "王大明" }),
            requestedStatus: "doctoral",
          },
          at(2 * HOUR)
        )
      )
      const accepted = await saveOk(
        s.store,
        resubmitted.accept(
          assignment({ mailGroups: ["g1", "g2"] }),
          resubmitted.version,
          admin,
          at(3 * HOUR)
        )
      )
      expect(accepted.assignment?.mailGroups).toHaveLength(2)
      const restored = await lock(s.store, a.id)
      expect(restored?.snapshot).toEqual(accepted.snapshot)
      expect(restored?.profile?.fields.chineseName).toBe("王大明")
      expect(restored?.changeRequest).toBeNull()
    })

    test("a refused transaction leaves nothing behind", async () => {
      const s = await subject()
      const t = App.submit(await submitInput(), NOW)
      await expect(
        s.store.transaction(async (uow) => {
          expect(await uow.save(t)).toBe("ok")
          await uow.queueMail(t.next.id, mail("verify", "a@example.com"))
          throw new Error("refused")
        })
      ).rejects.toThrow("refused")
      expect(await lock(s.store, t.next.id)).toBeNull()
      expect(await s.queuedMails()).toEqual([])
    })

    test("a failed savepoint undoes only its own writes", async () => {
      const s = await subject()
      const a = await seedPending(s.store)
      await s.store.transaction(async (uow) => {
        await uow.appendEvent(a.id, "link_sent", null, APPLICANT, at(1))
        await expect(
          uow.savepoint(async () => {
            await uow.appendEvent(a.id, "withdrawn", null, APPLICANT, at(2))
            throw new Error("inner")
          })
        ).rejects.toThrow("inner")
      })
      const rows = await s.store.reader.list({ closed: false })
      const row = rows.find((r) => r.application.id === a.id)
      expect(row?.events.map((e) => e.kind)).toEqual([
        "submitted",
        "verified",
        "link_sent",
      ])
    })

    test("one unverified application per email", async () => {
      const s = await subject()
      const email = Email.parse("same@example.com")
      const first = App.submit(await submitInput({ email }), NOW)
      expect(await s.store.transaction((uow) => uow.save(first))).toBe("ok")
      const second = App.submit(await submitInput({ email }), at(1))
      await expect(
        s.store.transaction((uow) => uow.save(second))
      ).rejects.toThrow("lab_applications_unverified_email")
      expect(await lock(s.store, second.next.id)).toBeNull()

      await saveOk(s.store, first.next.confirm(at(2)))
      expect(await s.store.transaction((uow) => uow.save(second))).toBe("ok")
    })

    test("save reports active_email_taken instead of throwing", async () => {
      const s = await subject()
      const email = Email.parse("taken@example.com")
      await seedPending(s.store, { email })
      const b = await saveOk(
        s.store,
        App.submit(await submitInput({ email }), at(1))
      )
      const result = await s.store.transaction((uow) =>
        uow.save(changed(b.confirm(at(2))))
      )
      expect(result).toBe("active_email_taken")
      const after = await lock(s.store, b.id)
      expect(after?.status).toBe("unverified")
      expect(after?.version).toBe(b.version)
    })

    test("active_email_taken leaves the transaction usable", async () => {
      const s = await subject()
      const tokens = new SequentialTokens()
      const email = Email.parse("taken@example.com")
      await seedPending(s.store, { email })
      const b = await saveOk(
        s.store,
        App.submit(await submitInput({ email }), at(1))
      )
      const token = tokens.generate()
      await s.store.transaction(async (uow) => {
        expect(await uow.save(changed(b.confirm(at(2))))).toBe(
          "active_email_taken"
        )
        await uow.putToken(b.id, "verify", token.hash, at(2))
        await uow.queueMail(b.id, mail("has_account", "taken@example.com"))
      })
      expect(await lock(s.store, b.id)).toMatchObject({ status: "unverified" })
      const found = await s.store.reader.byToken(token.hash, "verify")
      expect(found?.application.id).toBe(b.id)
      expect(await s.queuedMails()).toEqual([
        { applicationId: b.id, kind: "has_account", to: "taken@example.com" },
      ])
    })

    test("save reports username_claimed instead of throwing", async () => {
      const s = await subject()
      await seedProvisioning(s, "shared")
      const b = await seedPending(s.store)
      const result = await s.store.transaction((uow) =>
        uow.save(
          changed(
            b.accept(
              assignment({ username: Username.restore("shared") }),
              b.version,
              { kind: "admin", id: s.adminId },
              at(1)
            )
          )
        )
      )
      expect(result).toBe("username_claimed")
      const after = await lock(s.store, b.id)
      expect(after?.status).toBe("pending")
      expect(after?.assignment).toBeNull()
    })

    test("username_claimed leaves the transaction usable", async () => {
      const s = await subject()
      await seedProvisioning(s, "shared")
      const b = await seedPending(s.store)
      await s.store.transaction(async (uow) => {
        const t = b.accept(
          assignment({ username: Username.restore("shared") }),
          b.version,
          { kind: "admin", id: s.adminId },
          at(1)
        )
        expect(await uow.save(changed(t))).toBe("username_claimed")
        await uow.appendEvent(b.id, "link_sent", null, APPLICANT, at(2))
      })
      expect(await eventKinds(s.store, b.id)).toEqual([
        "submitted",
        "verified",
        "link_sent",
      ])
    })

    test("a store error outside a savepoint aborts the transaction", async () => {
      const s = await subject()
      const tokens = new SequentialTokens()
      const a = await seedPending(s.store)
      const b = await seedPending(s.store, { at: at(1) })
      const token = tokens.generate()
      await s.store.transaction((uow) =>
        uow.putToken(a.id, "access", token.hash, NOW)
      )
      let duplicate: unknown = null
      let followUp: unknown = null
      // Postgres rolls back on COMMIT after an error; a store may also reject.
      await s.store
        .transaction(async (uow) => {
          await uow.appendEvent(b.id, "link_sent", null, APPLICANT, at(2))
          duplicate = await uow
            .putToken(b.id, "access", token.hash, at(2))
            .then(
              () => null,
              (e: unknown) => e
            )
          followUp = await uow
            .queueMail(b.id, mail("received", "b@example.com"))
            .then(
              () => null,
              (e: unknown) => e
            )
        })
        .catch(() => undefined)
      expect(duplicate).toBeInstanceOf(Error)
      expect(followUp).toBeInstanceOf(Error)
      expect(await eventKinds(s.store, b.id)).toEqual(["submitted", "verified"])
      expect(await s.queuedMails()).toEqual([])
      const found = await s.store.reader.byToken(token.hash, "access")
      expect(found?.application.id).toBe(a.id)
    })

    test("a savepoint that catches a store error keeps the transaction usable", async () => {
      const s = await subject()
      const tokens = new SequentialTokens()
      const a = await seedPending(s.store)
      const b = await seedPending(s.store, { at: at(1) })
      const token = tokens.generate()
      await s.store.transaction((uow) =>
        uow.putToken(a.id, "access", token.hash, NOW)
      )
      const email = Email.parse("same@example.com")
      const first = App.submit(await submitInput({ email }), at(2))
      await s.store.transaction((uow) => uow.save(first))
      const second = App.submit(await submitInput({ email }), at(3))

      await s.store.transaction(async (uow) => {
        await expect(
          uow.savepoint(() => uow.putToken(b.id, "access", token.hash, at(4)))
        ).rejects.toThrow()
        await expect(uow.savepoint(() => uow.save(second))).rejects.toThrow()
        await uow.appendEvent(b.id, "link_sent", null, APPLICANT, at(5))
      })
      expect(await eventKinds(s.store, b.id)).toEqual([
        "submitted",
        "verified",
        "link_sent",
      ])
      const found = await s.store.reader.byToken(token.hash, "access")
      expect(found?.application.id).toBe(a.id)
      expect(await lock(s.store, second.next.id)).toBeNull()
    })

    test("save refuses a stale version", async () => {
      const s = await subject()
      const a = await seedPending(s.store)
      const t = changed(a.withdraw(at(1)))
      expect(await s.store.transaction((uow) => uow.save(t))).toBe("ok")
      await expect(s.store.transaction((uow) => uow.save(t))).rejects.toThrow(
        "version conflict"
      )
      expect((await lock(s.store, a.id))?.version).toBe(t.next.version)
    })

    test("save keeps a keycloak id set earlier in the transaction", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "kcuser")
      await s.store.transaction(async (uow) => {
        const locked = await uow.lock(a.id)
        if (!locked) throw new Error("missing")
        await uow.setKeycloakId(a.id, KC_A)
        const t = changed(
          locked.reassign({ username: Username.restore("kcother") }, at(1))
        )
        expect(t.next.keycloakId).toBeNull()
        expect(await uow.save(t)).toBe("ok")
      })
      const after = await lock(s.store, a.id)
      expect(after?.keycloakId).toBe(KC_A)
      expect(after?.assignment?.username.value).toBe("kcother")
    })

    test("concurrent transactions on the same run serialize", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "racer")
      await saveRun(s.store, ProvisioningRun.start(a.id, NOW))
      const failOnce = (n: number) =>
        s.store.transaction(async (uow) => {
          const run = await uow.lockRun(a.id)
          if (!run) throw new Error("missing run")
          // Give the other transaction a chance to interleave.
          await new Promise((resolve) => setTimeout(resolve, 10))
          await uow.saveRun(
            run.fail({ blocked: false, reason: `fail ${n}` }, retry, at(n))
          )
        })
      await Promise.all([failOnce(1), failOnce(2)])
      const run = await s.store.transaction((uow) => uow.lockRun(a.id))
      expect(run?.attempts).toBe(2)
    })

    test("putToken replaces the token of that purpose", async () => {
      const s = await subject()
      const tokens = new SequentialTokens()
      const a = await seedPending(s.store)
      const verify = tokens.generate()
      const first = tokens.generate()
      const second = tokens.generate()
      await s.store.transaction(async (uow) => {
        await uow.putToken(a.id, "verify", verify.hash, NOW)
        await uow.putToken(a.id, "access", first.hash, at(1))
      })
      await s.store.transaction((uow) =>
        uow.putToken(a.id, "access", second.hash, at(HOUR))
      )
      expect(await s.store.reader.byToken(first.hash, "access")).toBeNull()
      const found = await s.store.reader.byToken(second.hash, "access")
      expect(found?.application.id).toBe(a.id)
      expect(found?.tokenCreatedAt).toEqual(at(HOUR))
      expect(await s.store.reader.byToken(second.hash, "verify")).toBeNull()
      const kept = await s.store.transaction((uow) =>
        uow.lockByToken(verify.hash, "verify")
      )
      expect(kept?.application.id).toBe(a.id)
      expect(kept?.tokenCreatedAt).toEqual(NOW)
    })

    test("byToken reports releasedAt from the run", async () => {
      const s = await subject()
      const tokens = new SequentialTokens()
      const a = await seedProvisioning(s, "released")
      const token = tokens.generate()
      await s.store.transaction((uow) =>
        uow.putToken(a.id, "access", token.hash, NOW)
      )
      expect(
        (await s.store.reader.byToken(token.hash, "access"))?.releasedAt
      ).toBeNull()

      const run = completeAll(ProvisioningRun.start(a.id, NOW), at(1))
      await saveRun(s.store, run.finish(at(2), at(3)))
      expect(
        (await s.store.reader.byToken(token.hash, "access"))?.releasedAt
      ).toBeNull()
      await saveRun(s.store, run.finish(at(2), at(3)).release(at(HOUR)))
      expect(
        (await s.store.reader.byToken(token.hash, "access"))?.releasedAt
      ).toEqual(at(HOUR))
    })

    test("lockByEmail returns the newest application in the given statuses", async () => {
      const s = await subject()
      const email = Email.parse("again@example.com")
      const old = await seedPending(s.store, { email })
      await saveOk(s.store, old.withdraw(at(1)))
      const fresh = await seedPending(s.store, { email, at: at(HOUR) })
      const find = (statuses: readonly ApplicationStatus[]) =>
        s.store.transaction((uow) => uow.lockByEmail(email, statuses))
      expect((await find(["pending"]))?.id).toBe(fresh.id)
      expect((await find(["withdrawn"]))?.id).toBe(old.id)
      expect((await find(["withdrawn", "pending"]))?.id).toBe(fresh.id)
      expect(await find(["rejected"])).toBeNull()
      expect(
        await s.store.transaction((uow) =>
          uow.lockByEmail(Email.parse("nobody@example.com"), ["pending"])
        )
      ).toBeNull()
    })

    test("claimDue returns a due run and skips blocked, released or future ones", async () => {
      const s = await subject()
      const now = at(DAY)
      const blocked = await seedProvisioning(s, "blocked")
      await saveRun(
        s.store,
        ProvisioningRun.start(blocked.id, NOW).fail(
          { blocked: true, reason: "no" },
          retry,
          NOW
        )
      )
      const released = await seedProvisioning(s, "released")
      await saveRun(
        s.store,
        completeAll(ProvisioningRun.start(released.id, NOW), NOW)
          .finish(NOW, NOW)
          .release(NOW)
      )
      const future = await seedProvisioning(s, "future")
      await saveRun(
        s.store,
        ProvisioningRun.start(future.id, NOW).fail(
          { blocked: false, reason: "later" },
          retry,
          now
        )
      )
      const later = await seedProvisioning(s, "later")
      await saveRun(s.store, ProvisioningRun.start(later.id, at(HOUR)))
      const due = await seedProvisioning(s, "due")
      await saveRun(s.store, ProvisioningRun.start(due.id, at(MINUTE)))

      const claimed = await s.store.transaction((uow) => uow.claimDue(now))
      expect(claimed?.application.id).toBe(due.id)
      expect(claimed?.run.applicationId).toBe(due.id)
      expect(
        await s.store.transaction((uow) => uow.claimDue(at(-1)))
      ).toBeNull()
    })

    test("saveRun round-trips completed steps and restart removes them", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "steps")
      const run = ProvisioningRun.start(a.id, NOW)
        .complete("create_account", at(1))
        .complete("join_keycloak_groups", at(2))
        .fail({ blocked: false, reason: "flaky" }, retry, at(3))
      await saveRun(s.store, run)
      const loaded = await s.store.transaction((uow) => uow.lockRun(a.id))
      expect(loaded?.snapshot).toEqual(run.snapshot)

      const restarted = run.restart(retry, at(4))
      await saveRun(s.store, restarted)
      const after = await s.store.transaction((uow) => uow.lockRun(a.id))
      expect(after?.snapshot).toEqual(restarted.snapshot)
      expect(after?.snapshot.completed).toEqual([])
    })

    test("deleteRun removes the run and its steps", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "gone")
      await saveRun(
        s.store,
        ProvisioningRun.start(a.id, NOW).complete("create_account", at(1))
      )
      await s.store.transaction((uow) => uow.deleteRun(a.id))
      expect(await s.store.transaction((uow) => uow.lockRun(a.id))).toBeNull()
      await saveRun(s.store, ProvisioningRun.start(a.id, at(2)))
      const fresh = await s.store.transaction((uow) => uow.lockRun(a.id))
      expect(fresh?.snapshot.completed).toEqual([])
    })

    test("passwordMail derives from events in id order", async () => {
      const s = await subject()
      const a = await seedPending(s.store)
      const admin = { kind: "admin" as const, id: s.adminId }
      await s.store.transaction(async (uow) => {
        await uow.appendEvent(a.id, "password_mail_sent", null, SYSTEM, NOW)
        await uow.appendEvent(a.id, "password_mail_requested", null, admin, NOW)
      })
      const state = await s.store.reader.passwordMail(a.id)
      expect(state.pendingRequest).toEqual(admin)
      expect(state.lastSentAt).toEqual(NOW)
      const inTx = await s.store.transaction((uow) => uow.passwordMail(a.id))
      expect(inTx).toEqual(state)
    })

    test("claimAlert is won once per window", async () => {
      const s = await subject()
      const claim = (notBefore: Date, now: Date) =>
        s.store.transaction((uow) => uow.claimAlert("cohort", notBefore, now))
      expect(await claim(at(-DAY), NOW)).toBe(true)
      expect(await claim(at(HOUR - DAY), at(HOUR))).toBe(false)
      expect(await claim(at(1), at(DAY + 1))).toBe(true)
      expect(await claim(at(2), at(DAY + 2))).toBe(false)
    })

    test("reserveMail counts by rateKey and for the whole key", async () => {
      const s = await subject(new MailRatePolicy({ keyPerHour: 2 }))
      const reserve = (to: string, now: Date) =>
        s.store.transaction((uow) =>
          uow.reserveMail(Email.parse(to), "verify", now)
        )
      expect(await reserve("A.B+x@gmail.com", NOW)).toBe("ok")
      expect(await reserve("ab@googlemail.com", at(1))).toBe("recipient_limit")
      expect(await reserve("ab@gmail.com", at(HOUR))).toBe("ok")
      expect(await reserve("c@example.com", at(HOUR + 1))).toBe("ok")
      expect(await reserve("d@example.com", at(HOUR + 2))).toBe("key_limit")
    })

    test("delete removes the application's queued mails", async () => {
      const s = await subject()
      const a = await seedPending(s.store)
      const b = await seedPending(s.store)
      await s.store.transaction(async (uow) => {
        await uow.queueMail(a.id, mail("received", "a@example.com"))
        await uow.queueMail(b.id, mail("received", "b@example.com"))
        await uow.queueMail(null, mail("digest", "admin@example.com"))
      })
      await s.store.transaction((uow) => uow.delete(a.id))
      expect(await lock(s.store, a.id)).toBeNull()
      const left = await s.queuedMails()
      expect(left).toHaveLength(2)
      expect(left).toContainEqual({
        applicationId: b.id,
        kind: "received",
        to: "b@example.com",
      })
      expect(left).toContainEqual({
        applicationId: null,
        kind: "digest",
        to: "admin@example.com",
      })
    })

    test("purge keeps assigned values and removes personal data", async () => {
      const s = await subject()
      const admin = { kind: "admin" as const, id: s.adminId }
      const tokens = new SequentialTokens()
      let a = await seedPending(s.store)
      a = await saveOk(
        s.store,
        a.edit(
          {
            profile: await profile({ lineId: "newline" }),
            requestedStatus: "master",
          },
          a.version,
          admin,
          at(1)
        )
      )
      a = await saveOk(
        s.store,
        a.requestChanges(
          { note: "請補資料", dueAt: at(DAY) },
          a.version,
          admin,
          at(2)
        )
      )
      a = await saveOk(
        s.store,
        a.resubmit(
          {
            profile: await profile({ lineId: "newer" }),
            requestedStatus: "master",
          },
          at(3)
        )
      )
      a = await saveOk(
        s.store,
        a.accept(
          assignment({ username: Username.restore("purged") }),
          a.version,
          admin,
          at(4)
        )
      )
      const failed = ProvisioningRun.start(a.id, at(4)).fail(
        { blocked: false, reason: "連不到 Keycloak" },
        retry,
        at(5)
      )
      await saveRun(s.store, failed)
      await saveRun(s.store, completeAll(failed, at(6)))
      await s.store.transaction((uow) => uow.setKeycloakId(a.id, KC_B))
      const locked = await lock(s.store, a.id)
      if (!locked) throw new Error("missing")
      a = await saveOk(s.store, locked.finish(at(7)))
      const token = tokens.generate()
      await s.store.transaction(async (uow) => {
        await uow.putToken(a.id, "access", token.hash, at(7))
        await uow.queueMail(a.id, mail("approved", "x@example.com"))
      })

      await s.store.transaction(async (uow) => {
        const current = await uow.lock(a.id)
        if (!current) throw new Error("missing")
        expect(await uow.save(changed(current.purge(at(DAY))))).toBe("ok")
        await uow.purge(a.id, at(DAY))
      })

      const after = await lock(s.store, a.id)
      expect(after?.profile).toBeNull()
      expect(after?.email).toBeNull()
      expect(after?.assignment?.username.value).toBe("purged")
      expect(after?.assignment?.cohort.value).toBe(116)
      expect(after?.keycloakId).toBe(KC_B)
      expect(await s.store.reader.byToken(token.hash, "access")).toBeNull()
      expect(await s.queuedMails()).toEqual([])
      const run = await s.store.transaction((uow) => uow.lockRun(a.id))
      expect(run?.error).toBeNull()
      expect(run?.snapshot.completed).toHaveLength(5)
      expect(await s.changeRequestNotes(a.id)).toEqual([null])

      const rows = await s.store.reader.list({ closed: false })
      const row = rows.find((r) => r.application.id === a.id)
      expect(row).toBeDefined()
      const withChanges = row!.events.filter((e) => e.changes !== null)
      expect(withChanges.map((e) => e.kind)).toEqual([
        "edited",
        "changes_requested",
        "resubmitted",
        "accepted",
      ])
      for (const e of withChanges) {
        expect(Object.keys(e.changes!).length).toBeGreaterThan(0)
        expect(Object.values(e.changes!).every((v) => v === null)).toBe(true)
      }
      expect(Object.keys(withChanges[0].changes!)).toEqual(["line_id"])
    })

    test("list separates open and closed applications", async () => {
      const s = await subject()
      const unverified = await saveOk(
        s.store,
        App.submit(await submitInput(), NOW)
      )
      const pendingApp = await seedPending(s.store, { at: at(1) })
      const withdrawn = await seedPending(s.store, { at: at(2) })
      await saveOk(s.store, withdrawn.withdraw(at(3)))

      const accept = async (username: string, when: Date) => {
        const p = await seedProvisioning(s, username, { at: when })
        const run = completeAll(ProvisioningRun.start(p.id, when), when).finish(
          when,
          when
        )
        await saveRun(s.store, run)
        await s.store.transaction((uow) =>
          uow.setKeycloakId(p.id, crypto.randomUUID())
        )
        const locked = await lock(s.store, p.id)
        await saveOk(s.store, locked!.finish(when))
        return { id: p.id, run }
      }
      const held = await accept("held", at(4))
      const freed = await accept("freed", at(5))
      await saveRun(s.store, freed.run.release(at(6)))

      const ids = async (closed: boolean) =>
        (await s.store.reader.list({ closed })).map((r) => r.application.id)
      expect(await ids(false)).toEqual([pendingApp.id, held.id])
      expect(await ids(true)).toEqual([withdrawn.id, freed.id])
      const all = [...(await ids(false)), ...(await ids(true))]
      expect(all).not.toContain(unverified.id)

      const open = await s.store.reader.list({ closed: false })
      const heldRow = open.find((r) => r.application.id === held.id)
      expect(heldRow?.run?.applicationId).toBe(held.id)
      const eventIds = heldRow!.events.map((e) => e.id)
      expect(eventIds).toEqual([...eventIds].sort((x, y) => x - y))
      expect(open.find((r) => r.application.id === pendingApp.id)?.run).toBe(
        null
      )
    })

    test("claimedUsernames and history ignore the excepted application", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "alpha")
      const names = [Username.restore("alpha"), Username.restore("beta")]
      expect([...(await s.store.reader.claimedUsernames(names))]).toEqual([
        "alpha",
      ])
      expect((await s.store.reader.claimedUsernames(names, a.id)).size).toBe(0)

      const email = Email.parse("history@example.com")
      const first = await seedPending(s.store, { email })
      await saveOk(s.store, first.withdraw(at(1)))
      const second = await seedPending(s.store, { email, at: at(HOUR) })
      const h1 = await s.store.reader.history(email, second.id)
      expect(h1).toEqual([
        { id: first.id, status: "withdrawn", createdAt: NOW, closedAt: at(1) },
      ])
      const h2 = await s.store.reader.history(email, first.id)
      expect(h2).toEqual([
        {
          id: second.id,
          status: "pending",
          createdAt: at(HOUR),
          closedAt: null,
        },
      ])
      const rows = await s.store.reader.list({ closed: false })
      expect(rows.find((r) => r.application.id === second.id)?.history).toEqual(
        h1
      )
    })

    test("markMailGroupAdded and setKeycloakId persist", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "groups", {
        mailGroups: ["g1", "g2"],
      })
      await s.store.transaction(async (uow) => {
        await uow.markMailGroupAdded(a.id, "g1", at(1))
        await uow.setKeycloakId(a.id, KC_C)
      })
      const after = await lock(s.store, a.id)
      expect(after?.keycloakId).toBe(KC_C)
      const groups = after?.assignment?.mailGroups ?? []
      expect(
        [...groups].sort((x, y) => x.groupId.localeCompare(y.groupId))
      ).toEqual([
        { groupId: "g1", addedAt: at(1) },
        { groupId: "g2", addedAt: null },
      ])
      await s.store.transaction((uow) => uow.setKeycloakId(a.id, null))
      expect((await lock(s.store, a.id))?.keycloakId).toBeNull()
    })

    test("setKeycloakId refuses an id that is not a UUID", async () => {
      const s = await subject()
      const a = await seedProvisioning(s, "notuuid")
      await expect(
        s.store.transaction((uow) => uow.setKeycloakId(a.id, "kc-1"))
      ).rejects.toThrow()
      expect((await lock(s.store, a.id))?.keycloakId).toBeNull()
    })

    test("data handed in or out is copied", async () => {
      const s = await subject()
      const a = await seedPending(s.store)
      const when = at(1)
      const changes = { list: ["x"], nested: { n: 1 } }
      await s.store.transaction((uow) =>
        uow.appendEvent(a.id, "link_sent", changes, APPLICANT, when)
      )
      when.setTime(0)
      changes.list.push("y")
      changes.nested.n = 2

      const first = await s.store.reader.list({ closed: false })
      const row = first.find((r) => r.application.id === a.id)!
      const ev = row.events.find((e) => e.kind === "link_sent")!
      expect(ev.at).toEqual(at(1))
      expect(ev.changes).toEqual({ list: ["x"], nested: { n: 1 } })
      ev.at.setTime(0)
      ;(ev.changes!.list as string[]).push("z")
      row.events.length = 0
      row.history.push({
        id: "x",
        status: "pending",
        createdAt: NOW,
        closedAt: null,
      })

      const second = await s.store.reader.list({ closed: false })
      const again = second.find((r) => r.application.id === a.id)!
      const ev2 = again.events.find((e) => e.kind === "link_sent")!
      expect(ev2.at).toEqual(at(1))
      expect(ev2.changes).toEqual({ list: ["x"], nested: { n: 1 } })
      expect(again.history).toEqual([])

      const run = ProvisioningRun.start(a.id, NOW)
      await saveRun(s.store, run)
      const loaded = await s.store.transaction((uow) => uow.lockRun(a.id))
      loaded!.nextAt.setTime(0)
      expect(
        (await s.store.transaction((uow) => uow.lockRun(a.id)))?.nextAt
      ).toEqual(NOW)
    })
  })
}
