import { describe, expect, test } from "bun:test"

import { Application, SYSTEM } from "../domain/application"
import { RetentionPolicy, RetryPolicy } from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import { Email } from "../domain/values"
import type { Tracer } from "../ports"
import { MailComposer } from "../services/mail-composer"
import { FixedClock } from "../testing/clock"
import { FakeAuthority, NoopTracer, RecordingNotifier } from "../testing/fakes"
import {
  ADMIN,
  NOW,
  assignment,
  profile,
  submitInput,
} from "../testing/fixtures"
import { InMemoryApplicationStore } from "../testing/memory-store"
import { SequentialTokens } from "../testing/tokens"
import { RetentionJob } from "./retention-job"

const SEC = 1000
const HOUR = 3_600_000
const DAY = 24 * HOUR
const KC = "11111111-1111-4111-8111-111111111111"
const retention = new RetentionPolicy()
const tokens = new SequentialTokens()

const composerDeps = {
  siteUrl: "https://portal.example.test",
  resetPasswordUrl: "https://id.example.test/reset",
}

class RecordingTracer implements Tracer {
  spans: { name: string; failed: boolean }[] = []
  async span<T>(
    name: string,
    _attrs: Record<string, string | number>,
    fn: () => Promise<T>
  ): Promise<T> {
    try {
      const result = await fn()
      this.spans.push({ name, failed: false })
      return result
    } catch (error) {
      this.spans.push({ name, failed: true })
      throw error
    }
  }
}

class ThrowingRejectedComposer extends MailComposer {
  rejected(): never {
    throw new Error("composer broke")
  }
}

async function setup(
  opts: {
    now?: Date
    composer?: MailComposer
    tracer?: Tracer
    processors?: string[]
  } = {}
) {
  const store = await InMemoryApplicationStore.create()
  const clock = new FixedClock(opts.now ?? NOW)
  const notifier = new RecordingNotifier()
  const job = new RetentionJob({
    store,
    clock,
    retention,
    composer: opts.composer ?? new MailComposer(composerDeps),
    authority: new FakeAuthority({
      processorEmails: opts.processors ?? ["p1@winlab.tw", "p2@winlab.tw"],
    }),
    notifier,
    tracer: opts.tracer ?? new NoopTracer(),
  })
  return { store, clock, notifier, job }
}
type Ctx = Awaited<ReturnType<typeof setup>>

const ago = (ms: number, from: Date = NOW) => new Date(from.getTime() - ms)

async function save(ctx: Ctx, t: ReturnType<Application["confirm"]>) {
  if (t.kind !== "changed") throw new Error("expected a change")
  await ctx.store.transaction((uow) => uow.save(t))
  return t.next
}

async function exists(ctx: Ctx, id: string) {
  return (await ctx.store.transaction((uow) => uow.lock(id))) !== null
}

async function seedUnverified(ctx: Ctx, tokenAt: Date) {
  const submitted = await save(
    ctx,
    Application.submit(await submitInput(), ago(10 * DAY))
  )
  await ctx.store.transaction((uow) =>
    uow.putToken(submitted.id, "verify", tokens.generate().hash, tokenAt)
  )
  return submitted
}

async function seedPending(ctx: Ctx, verifiedAt: Date, over = {}) {
  const submitted = await save(
    ctx,
    Application.submit(await submitInput(over), verifiedAt)
  )
  return save(ctx, submitted.confirm(verifiedAt))
}

async function seedChangesRequested(ctx: Ctx, dueAt: Date) {
  const a = await seedPending(ctx, ago(60 * DAY))
  return save(
    ctx,
    a.requestChanges(
      { note: "請補學號", dueAt },
      a.version,
      ADMIN,
      ago(30 * DAY)
    )
  )
}

async function seedClosedRejected(ctx: Ctx, closedAt: Date) {
  const a = await seedPending(ctx, ago(200 * DAY))
  return save(ctx, a.reject("不符", ADMIN, closedAt))
}

describe("RetentionJob", () => {
  test("deletes unverified applications whose verify token is a day old", async () => {
    const ctx = await setup()
    const cutoff = retention.verifyCutoff(NOW)
    const young = await seedUnverified(ctx, new Date(cutoff.getTime() + SEC))
    const old = await seedUnverified(ctx, new Date(cutoff.getTime() - SEC))
    await ctx.job.tick()
    expect(await exists(ctx, young.id)).toBe(true)
    expect(await exists(ctx, old.id)).toBe(false)
  })

  test("counts the unverified deadline from the latest verify token", async () => {
    const ctx = await setup()
    const a = await seedUnverified(ctx, ago(3 * DAY))
    await ctx.store.transaction((uow) =>
      uow.putToken(a.id, "verify", tokens.generate().hash, ago(HOUR))
    )
    await ctx.job.tick()
    expect(await exists(ctx, a.id)).toBe(true)
  })

  test("deletes verify tokens past use but keeps younger ones and access tokens", async () => {
    const ctx = await setup()
    const cutoff = retention.verifyCutoff(NOW)
    const oldApp = await seedPending(ctx, ago(5 * DAY))
    const youngApp = await seedPending(ctx, ago(5 * DAY))
    const oldVerify = tokens.generate()
    const youngVerify = tokens.generate()
    const access = tokens.generate()
    await ctx.store.transaction(async (uow) => {
      await uow.putToken(
        oldApp.id,
        "verify",
        oldVerify.hash,
        new Date(cutoff.getTime() - SEC)
      )
      await uow.putToken(oldApp.id, "access", access.hash, ago(5 * DAY))
      await uow.putToken(
        youngApp.id,
        "verify",
        youngVerify.hash,
        new Date(cutoff.getTime() + SEC)
      )
    })
    await ctx.job.tick()
    const reader = ctx.store.reader
    expect(await reader.byToken(oldVerify.hash, "verify")).toBeNull()
    expect(await reader.byToken(youngVerify.hash, "verify")).not.toBeNull()
    expect(await reader.byToken(access.hash, "access")).not.toBeNull()
  })

  test("rejects an application 14 days after its change deadline, once", async () => {
    const ctx = await setup()
    const cutoff = retention.autoRejectCutoff(NOW)
    const young = await seedChangesRequested(
      ctx,
      new Date(cutoff.getTime() + SEC)
    )
    const old = await seedChangesRequested(
      ctx,
      new Date(cutoff.getTime() - SEC)
    )
    await ctx.job.tick()
    const rows = await ctx.store.reader.list({ closed: true })
    const rejected = rows.find((r) => r.application.id === old.id)
    expect(rejected?.application.status).toBe("rejected")
    expect(rejected?.application.reviewNote).toBe("逾期未修改")
    expect(rejected?.application.reviewedBy).toBeNull()
    expect(rejected?.application.closedAt).toEqual(NOW)
    expect(rejected?.events.at(-1)).toMatchObject({
      kind: "rejected",
      actor: SYSTEM,
    })
    expect(
      (await ctx.store.reader.list({ closed: false })).map(
        (r) => r.application.status
      )
    ).toContain("changes_requested")
    expect(
      (await ctx.store.reader.list({ closed: false })).find(
        (r) => r.application.id === young.id
      )?.application.status
    ).toBe("changes_requested")
    const mails = ctx.store.outbox().filter((m) => m.mail.kind === "rejected")
    expect(mails.map((m) => m.applicationId)).toEqual([old.id])
    expect(mails[0].mail.to).toBe(old.email!.value)
    await ctx.job.tick()
    expect(
      ctx.store.outbox().filter((m) => m.mail.kind === "rejected")
    ).toHaveLength(1)
  })

  test("purges personal data 90 days after close and keeps the assignment", async () => {
    const ctx = await setup()
    const cutoff = retention.purgeCutoff(NOW)
    const young = await seedClosedRejected(
      ctx,
      new Date(cutoff.getTime() + SEC)
    )
    // An accepted application: closed when provisioning finished.
    const base = await seedPending(ctx, ago(200 * DAY))
    const accepted = await save(
      ctx,
      base.accept(assignment(), base.version, ADMIN, ago(150 * DAY))
    )
    await ctx.store.transaction(async (uow) => {
      const run = ProvisioningRun.start(accepted.id, ago(150 * DAY)).fail(
        { blocked: false, reason: "keycloak said 500 for xmwang" },
        new RetryPolicy(),
        ago(149 * DAY)
      )
      await uow.saveRun(run)
      await uow.setKeycloakId(accepted.id, KC)
    })
    const withAccount = await ctx.store.transaction((uow) =>
      uow.lock(accepted.id)
    )
    const done = await save(
      ctx,
      withAccount!.finish(new Date(cutoff.getTime() - SEC))
    )
    await ctx.job.tick()

    const rows = await ctx.store.reader.list({ closed: true })
    const row = rows.find((r) => r.application.id === done.id)
    expect(row?.application.purgedAt).toEqual(NOW)
    expect(row?.application.email).toBeNull()
    expect(row?.application.profile).toBeNull()
    expect(row?.application.assignment?.username.value).toBe("xmwang")
    expect(row?.application.assignment?.cohort.value).toBe(116)
    expect(row?.run?.error).toBeNull()
    const kept = rows.find((r) => r.application.id === young.id)
    expect(kept?.application.purgedAt).toBeNull()
    expect(kept?.application.email).not.toBeNull()
    // Purging again changes nothing.
    await ctx.job.tick()
    const again = (await ctx.store.reader.list({ closed: true })).find(
      (r) => r.application.id === done.id
    )
    expect(again?.application.version).toBe(row?.application.version)
  })

  test("deletes mail log entries older than the log window", async () => {
    const ctx = await setup()
    const cutoff = retention.mailLogCutoff(NOW)
    const log = (n: number, at: Date) =>
      ctx.store.transaction((uow) =>
        uow.reserveMail(Email.parse(`log${n}@example.com`), "verify", at)
      )
    await log(1, new Date(cutoff.getTime() + SEC))
    await log(2, new Date(cutoff.getTime() - SEC))
    await ctx.job.tick()
    // Only the younger entry is left.
    expect(
      await ctx.store.transaction((uow) =>
        uow.deleteMailLog(new Date(NOW.getTime() + DAY))
      )
    ).toBe(1)
  })

  describe("digest", () => {
    // Taipei is UTC+8: 09:00 there is 01:00Z.
    const at = (iso: string) => new Date(iso)
    const digests = (ctx: Ctx) =>
      ctx.store.outbox().filter((m) => m.mail.kind === "digest")

    test("mails each processor how many applications wait, naming no one", async () => {
      const ctx = await setup({ now: at("2026-11-24T02:00:00Z") })
      const stale = new Date(ctx.clock.now().getTime() - 3 * DAY - SEC)
      const fresh = new Date(ctx.clock.now().getTime() - 3 * DAY + SEC)
      await seedPending(ctx, stale)
      await seedPending(ctx, fresh)
      await ctx.job.tick()
      const sent = digests(ctx)
      expect(sent.map((m) => m.mail.to).sort()).toEqual([
        "p1@winlab.tw",
        "p2@winlab.tw",
      ])
      for (const m of sent) {
        const text = `${m.mail.subject}${m.mail.text}${m.mail.html}`
        expect(text).toContain("1 筆")
        const p = await profile()
        for (const secret of [
          p.fields.chineseName,
          p.fields.phone,
          p.fields.lineId,
          p.fields.studentId,
        ]) {
          expect(text).not.toContain(secret)
        }
      }
    })

    test("sends nothing when no application waited long enough", async () => {
      const ctx = await setup({ now: at("2026-11-24T02:00:00Z") })
      await seedPending(
        ctx,
        new Date(ctx.clock.now().getTime() - 3 * DAY + SEC)
      )
      await ctx.job.tick()
      expect(digests(ctx)).toHaveLength(0)
    })

    test("waits for 09:00 in Taipei", async () => {
      const ctx = await setup({ now: at("2026-11-23T00:59:59Z") })
      await seedPending(ctx, at("2026-11-10T00:00:00Z"))
      await ctx.job.tick()
      expect(digests(ctx)).toHaveLength(0)
      ctx.clock.set(at("2026-11-23T01:00:00Z"))
      await ctx.job.tick()
      expect(digests(ctx)).toHaveLength(2)
    })

    test("goes out once per Taipei day", async () => {
      const ctx = await setup({ now: at("2026-11-23T01:30:00Z") })
      await seedPending(ctx, at("2026-11-10T00:00:00Z"))
      await ctx.job.tick()
      ctx.clock.set(at("2026-11-23T07:30:00Z"))
      await ctx.job.tick()
      // 15:59 Taipei is still the same day; 16:00Z is the next day's 00:00.
      ctx.clock.set(at("2026-11-23T15:59:00Z"))
      await ctx.job.tick()
      expect(digests(ctx)).toHaveLength(2)
      ctx.clock.set(at("2026-11-24T01:00:00Z"))
      await ctx.job.tick()
      expect(digests(ctx)).toHaveLength(4)
    })
  })

  test("a failing item does not stop the others, and tick still fails", async () => {
    const tracer = new RecordingTracer()
    const ctx = await setup({
      composer: new ThrowingRejectedComposer(composerDeps),
      tracer,
    })
    await seedChangesRequested(
      ctx,
      new Date(retention.autoRejectCutoff(NOW).getTime() - SEC)
    )
    await ctx.store.transaction((uow) =>
      uow.reserveMail(
        Email.parse("old@example.com"),
        "verify",
        new Date(retention.mailLogCutoff(NOW).getTime() - SEC)
      )
    )
    const gone = await seedUnverified(
      ctx,
      new Date(retention.verifyCutoff(NOW).getTime() - SEC)
    )
    await expect(ctx.job.tick()).rejects.toThrow()
    expect(await exists(ctx, gone.id)).toBe(false)
    expect(
      await ctx.store.transaction((uow) =>
        uow.deleteMailLog(new Date(NOW.getTime() + DAY))
      )
    ).toBe(0)
    expect(tracer.spans.filter((s) => s.failed)).toHaveLength(1)
    expect(tracer.spans.length).toBeGreaterThanOrEqual(6)
    // The failed item rolled back whole: the application is still waiting.
    expect((await ctx.store.reader.list({ closed: true })).length).toBe(0)
    // Writes that did commit were announced once.
    expect(ctx.notifier.count).toBe(1)
  })

  test("touches at most 100 rows per item per tick", async () => {
    const ctx = await setup()
    const old = new Date(retention.verifyCutoff(NOW).getTime() - SEC)
    const ids: string[] = []
    for (let i = 0; i < 101; i++) ids.push((await seedUnverified(ctx, old)).id)
    await ctx.job.tick()
    let left = 0
    for (const id of ids) if (await exists(ctx, id)) left += 1
    expect(left).toBe(1)
  })

  test("announces a change once, and not when nothing was done", async () => {
    const ctx = await setup()
    await seedPending(ctx, ago(HOUR))
    await ctx.job.tick()
    expect(ctx.notifier.count).toBe(0)
    await seedUnverified(
      ctx,
      new Date(retention.verifyCutoff(NOW).getTime() - SEC)
    )
    await seedClosedRejected(ctx, ago(100 * DAY))
    await ctx.job.tick()
    expect(ctx.notifier.count).toBe(1)
  })
})
