import { SYSTEM } from "../domain/application"
import { STEP_NAMES } from "../domain/constants"
import type { RetryPolicy } from "../domain/policies"
import type {
  ApplicationStore,
  ChangeNotifier,
  Clock,
  ProcessorAuthority,
  Tracer,
  UnitOfWork,
} from "../ports"
import type { MailComposer } from "../services/mail-composer"
import { StepError } from "./step-error"
import { STEP_TIMEOUT_MS, type ProvisioningStep } from "./steps"

const BASE_PAUSE_MS = 5_000
const MAX_PAUSE_MS = 300_000

export type ProvisioningWorkerDeps = {
  store: ApplicationStore
  clock: Clock
  steps: readonly ProvisioningStep[]
  retry: RetryPolicy
  tracer: Tracer
  notifier: ChangeNotifier
  /** For `close_has_account`: the mails to the applicant and the processors. */
  composer: MailComposer
  authority: ProcessorAuthority
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Claims one due provisioning run per transaction and runs its next step.
 * A step that throws rolls back only its savepoint; the failure event and
 * the run's new state are written in the same transaction.
 */
export class ProvisioningWorker {
  private running = false

  constructor(private readonly d: ProvisioningWorkerDeps) {}

  /** Did one round of work. */
  tick(): Promise<boolean> {
    return this.d.store.transaction((uow) => this.round(uow))
  }

  /** Works until nothing is due; a second call while one runs returns at once. */
  async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    const sleep = this.d.sleep ?? defaultSleep
    let worked = false
    let failures = 0
    let capped = false
    try {
      for (;;) {
        let did: boolean
        try {
          did = await this.tick()
        } catch (error) {
          if (capped) throw error
          const pause = Math.min(BASE_PAUSE_MS * 2 ** failures, MAX_PAUSE_MS)
          capped = pause >= MAX_PAUSE_MS
          failures += 1
          await sleep(pause)
          continue
        }
        failures = 0
        capped = false
        if (!did) break
        worked = true
      }
    } finally {
      this.running = false
      if (worked) await this.d.notifier.changed()
    }
  }

  private async round(uow: UnitOfWork): Promise<boolean> {
    const { clock, retry } = this.d
    const now = clock.now()
    const claimed = await uow.claimDue(now)
    if (!claimed) return false
    const { application, run } = claimed

    const name = run.nextStep(STEP_NAMES)
    if (name === null) {
      await uow.saveRun(run.finish(now))
      return true
    }
    const step = this.d.steps.find((s) => s.name === name)
    if (!step) throw new Error(`no provisioning step named ${name}`)

    let result
    try {
      result = await this.d.tracer.span(
        `provision ${name}`,
        { application: application.id },
        () =>
          uow.savepoint(() =>
            step.run({
              application,
              run,
              uow,
              now,
              signal: AbortSignal.timeout(STEP_TIMEOUT_MS[name]),
            })
          ),
        (e) => e instanceof StepError && e.blocked
      )
    } catch (error) {
      const failure = StepError.from(error)
      const next = run.fail(failure, retry, now)
      await uow.saveRun(next)
      await uow.appendEvent(
        application.id,
        next.blocked ? "provision_blocked" : "provision_failed",
        { step: name, error: failure.reason },
        SYSTEM,
        now
      )
      return true
    }

    switch (result.kind) {
      case "done": {
        let next = run.complete(name, now)
        if (name === "finish") next = next.finish(now)
        await uow.saveRun(next)
        await uow.appendEvent(
          application.id,
          "provision_step",
          { step: name },
          SYSTEM,
          now
        )
        return true
      }
      case "restart": {
        const next = run.restart(retry, now)
        await uow.saveRun(next)
        await uow.setKeycloakId(application.id, null)
        await uow.appendEvent(
          application.id,
          next.blocked ? "provision_blocked" : "provision_failed",
          { step: name, error: next.error },
          SYSTEM,
          now
        )
        return true
      }
      case "close_has_account": {
        const closed = application.closeHasAccount(now)
        if (closed.kind === "changed") await uow.save(closed)
        await uow.deleteRun(application.id)
        if (!application.email) {
          throw new Error(`application ${application.id} has no email`)
        }
        const { composer, authority } = this.d
        await uow.queueMail(
          application.id,
          composer.hasAccount(application.email)
        )
        for (const to of new Set(await authority.processorEmails())) {
          await uow.queueMail(application.id, composer.closedHasAccount(to))
        }
        return true
      }
    }
  }
}
