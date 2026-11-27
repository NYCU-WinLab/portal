import { describe, expect, test } from "bun:test"

import type { Application } from "../domain/application"
import { STEP_NAMES, type StepName } from "../domain/constants"
import { RetryPolicy } from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import { Username } from "../domain/values"
import { MailComposer } from "../services/mail-composer"
import { FixedClock } from "../testing/clock"
import { FakeAuthority, NoopTracer, RecordingNotifier } from "../testing/fakes"
import { ADMIN, NOW, assignment, pending } from "../testing/fixtures"
import { InMemoryApplicationStore } from "../testing/memory-store"
import type { Tracer } from "../ports"
import { StepError } from "./step-error"
import type { ProvisioningStep, StepContext, StepResult } from "./steps"
import { ProvisioningWorker } from "./worker"

const MIN = 60_000
const DONE: StepResult = { kind: "done" }

type Script = (ctx: StepContext) => Promise<StepResult>

class FakeStep implements ProvisioningStep {
  calls: StepContext[] = []
  constructor(
    readonly name: StepName,
    private readonly scripts: Script[] = []
  ) {}
  async run(ctx: StepContext): Promise<StepResult> {
    this.calls.push(ctx)
    const script = this.scripts.shift()
    return script ? script(ctx) : DONE
  }
}

async function setup(
  scripts: Partial<Record<StepName, Script[]>> = {},
  opts: { store?: InMemoryApplicationStore; tracer?: Tracer } = {}
) {
  const store = opts.store ?? (await InMemoryApplicationStore.create())
  const base = await pending()
  const accepted = base.accept(assignment(), base.version, ADMIN, NOW)
  if (accepted.kind !== "changed") throw new Error("accept did not change")
  const app = accepted.next
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
  const clock = new FixedClock()
  const steps = STEP_NAMES.map((n) => new FakeStep(n, scripts[n]))
  const notifier = new RecordingNotifier()
  const sleeps: number[] = []
  const authority = new FakeAuthority({
    processorEmails: ["p1@winlab.tw", "p2@winlab.tw"],
  })
  const worker = new ProvisioningWorker({
    store,
    clock,
    steps,
    retry: new RetryPolicy(),
    tracer: opts.tracer ?? new NoopTracer(),
    notifier,
    composer: new MailComposer({
      siteUrl: "https://portal.example.test",
      resetPasswordUrl: "https://id.example.test/reset",
    }),
    authority,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  return { store, app, clock, steps, notifier, sleeps, worker }
}
type H = Awaited<ReturnType<typeof setup>>

const row = async (h: H) =>
  (await h.store.reader.list({ closed: false })).find(
    (r) => r.application.id === h.app.id
  )!

const fail =
  (reason = "壞了"): Script =>
  async () => {
    throw StepError.retry(reason)
  }

describe("tick", () => {
  test("does nothing when no run is due", async () => {
    const h = await setup()
    for (let i = 0; i < 4; i++) await h.worker.tick()
    expect(await h.worker.tick()).toBe(false)
  })

  test("runs the four steps in order, then the run is finished", async () => {
    const h = await setup()
    for (let i = 0; i < 4; i++) expect(await h.worker.tick()).toBe(true)
    expect(await h.worker.tick()).toBe(false)
    const r = await row(h)
    expect(r.run!.finished).toBe(true)
    const steps = r.events
      .filter((e) => e.kind === "provision_step")
      .map((e) => e.changes)
    expect(steps).toEqual(STEP_NAMES.map((step) => ({ step })))
  })

  test("backs off 1m, 5m, 15m, 1h and blocks on the 6th failure", async () => {
    const h = await setup({ create_account: Array(6).fill(fail("慢")) })
    for (const w of [1, 5, 15, 60]) {
      expect(await h.worker.tick()).toBe(true)
      const run = (await row(h)).run!
      expect(run.nextAt.getTime()).toBe(h.clock.now().getTime() + w * MIN)
      h.clock.advance(w * MIN)
    }
    await h.worker.tick()
    expect((await row(h)).run!.blocked).toBe(false)
    h.clock.advance(60 * MIN)
    await h.worker.tick()
    const r = await row(h)
    expect(r.run!.blocked).toBe(true)
    const kinds = r.events.map((e) => e.kind)
    expect(kinds.filter((k) => k === "provision_failed")).toHaveLength(5)
    const last = r.events.at(-1)!
    expect(last.kind).toBe("provision_blocked")
    expect(last.changes).toEqual({ step: "create_account", error: "慢" })
    expect(await h.worker.tick()).toBe(false)
  })

  test("a blocked StepError blocks at once and is not a span error", async () => {
    const seen: boolean[] = []
    const tracer: Tracer = {
      async span(_n, _a, fn, expected) {
        try {
          return await fn()
        } catch (e) {
          seen.push(expected?.(e) ?? false)
          throw e
        }
      },
    }
    const h = await setup(
      {
        create_account: [
          async () => {
            throw StepError.blocked("請改派")
          },
        ],
      },
      { tracer }
    )
    await h.worker.tick()
    const r = await row(h)
    expect(r.run!.blocked).toBe(true)
    expect(r.events.at(-1)!.kind).toBe("provision_blocked")
    expect(seen).toEqual([true])
  })

  test("a plain error is a retry with the generic reason", async () => {
    const h = await setup({
      create_account: [
        async () => {
          throw new Error("secret detail")
        },
      ],
    })
    await h.worker.tick()
    const r = await row(h)
    expect(r.run!.error).not.toContain("secret")
    expect(r.events.at(-1)!.kind).toBe("provision_failed")
  })

  test("a step that wrote and then threw loses its writes but not the error event", async () => {
    const h = await setup({
      create_account: [
        async ({ uow, application }) => {
          await uow.setKeycloakId(application.id, "kc-half")
          throw StepError.retry("寫到一半")
        },
      ],
    })
    await h.worker.tick()
    const r = await row(h)
    expect(r.application.keycloakId).toBeNull()
    expect(r.run!.attempts).toBe(1)
    expect(r.events.at(-1)!.changes).toEqual({
      step: "create_account",
      error: "寫到一半",
    })
  })

  test("a step that outlives its timeout is a retry", async () => {
    const h = await setup({
      create_account: [
        ({ signal }) =>
          new Promise((_, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason))
          ),
      ],
    })
    const orig = AbortSignal.timeout
    AbortSignal.timeout = () => AbortSignal.abort(new Error("timeout"))
    try {
      await h.worker.tick()
    } finally {
      AbortSignal.timeout = orig
    }
    const r = await row(h)
    expect(r.run!.attempts).toBe(1)
    expect(r.events.at(-1)!.kind).toBe("provision_failed")
  })

  test("restart goes back to the first step and clears the keycloak id", async () => {
    const h = await setup({
      create_account: [
        async ({ uow, application }) => {
          await uow.setKeycloakId(application.id, "kc-1")
          return DONE
        },
      ],
      join_mail_groups: [async () => ({ kind: "restart" })],
    })
    await h.worker.tick()
    expect((await row(h)).application.keycloakId).toBe("kc-1")
    await h.worker.tick()
    const r = await row(h)
    expect(r.application.keycloakId).toBeNull()
    expect(r.run!.attempts).toBe(1)
    expect(r.run!.nextStep(STEP_NAMES)).toBe("create_account")
    expect(r.events.at(-1)!.kind).toBe("provision_failed")
    expect(r.events.at(-1)!.changes).toEqual({
      step: "join_mail_groups",
      error: r.run!.error,
    })
  })

  test("close_has_account deletes the run and mails both sides", async () => {
    const h = await setup({
      create_account: [async () => ({ kind: "close_has_account" })],
    })
    expect(await h.worker.tick()).toBe(true)
    expect(await h.worker.tick()).toBe(false)
    const all = await h.store.reader.list({ closed: true })
    const closed = all.find((r) => r.application.id === h.app.id)!
    expect(closed.application.status).toBe("rejected")
    expect(closed.run).toBeNull()
    const sent = h.store.outbox().map((m) => [m.kind, m.to])
    expect(sent.sort()).toEqual(
      [
        ["closed_has_account", "p1@winlab.tw"],
        ["closed_has_account", "p2@winlab.tw"],
        ["has_account", h.app.email!.value],
      ].sort()
    )
  })

  test("a retry with a new username reaches the next create_account", async () => {
    const seen: string[] = []
    const record: Script = async ({ application }) => {
      seen.push(application.assignment!.username.value)
      throw StepError.blocked("改派")
    }
    const h = await setup({ create_account: [record, record] })
    await h.worker.tick()
    await h.store.transaction(async (uow) => {
      const app = (await uow.lock(h.app.id)) as Application
      const run = (await uow.lockRun(h.app.id))!
      const t = app.reassign(
        { username: Username.restore("newname") },
        h.clock.now()
      )
      if (t.kind !== "changed") throw new Error("no change")
      await uow.save(t)
      await uow.saveRun(run.retry({ username: "newname" }, h.clock.now()))
    })
    await h.worker.tick()
    expect(seen).toEqual(["xmwang", "newname"])
  })
})

describe("drain", () => {
  test("works until nothing is due and announces once", async () => {
    const h = await setup()
    await h.worker.drain()
    expect((await row(h)).run!.finished).toBe(true)
    expect(h.notifier.count).toBe(1)
    await h.worker.drain()
    expect(h.notifier.count).toBe(1)
  })

  test("a second drain while one runs does not re-enter", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const h = await setup({
      create_account: [
        async () => {
          await gate
          return DONE
        },
      ],
    })
    const first = h.worker.drain()
    await new Promise((r) => setTimeout(r, 5))
    await h.worker.drain()
    release()
    await first
    expect(h.steps[0].calls).toHaveLength(1)
    expect(h.notifier.count).toBe(1)
  })

  test("a store error sleeps 5s, 10s, 20s and resets after a success", async () => {
    const store = await InMemoryApplicationStore.create()
    const h = await setup({}, { store })
    let failures = 3
    const realTx = store.transaction.bind(store)
    store.transaction = ((work: never) => {
      if (failures > 0) {
        failures -= 1
        return Promise.reject(new Error("db down"))
      }
      return realTx(work)
    }) as typeof store.transaction
    await h.worker.drain()
    expect(h.sleeps).toEqual([5000, 10000, 20000])
    expect((await row(h)).run!.finished).toBe(true)
  })

  test("throws once the capped sleep has failed too", async () => {
    const store = await InMemoryApplicationStore.create()
    const h = await setup({}, { store })
    store.transaction = (() =>
      Promise.reject(new Error("db down"))) as typeof store.transaction
    await expect(h.worker.drain()).rejects.toThrow("db down")
    expect(h.sleeps.at(-1)).toBe(300_000)
    expect(h.sleeps.slice(0, 6)).toEqual([
      5000, 10000, 20000, 40000, 80000, 160000,
    ])
  })
})
