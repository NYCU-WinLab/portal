import { STEP_NAMES, type StepName } from "./constants"
import type { RetryPolicy } from "./policies"
import { ApplicationRefusal } from "./refusal"

/** What a failed step tells the run; PR 4's StepError satisfies it. */
export type StepFailure = { blocked: boolean; reason: string }

export const RESTART_REASON = "Keycloak 帳號不見了，從第一步重建"

export type RunSnapshot = {
  applicationId: string
  attempts: number
  nextAt: Date
  error: string | null
  blockedAt: Date | null
  startedAt: Date
  finishedAt: Date | null
  completed: readonly { step: StepName; at: Date }[]
}

const copyDate = (d: Date | null) => (d ? new Date(d) : null)

function copy(s: RunSnapshot): RunSnapshot {
  return {
    applicationId: s.applicationId,
    attempts: s.attempts,
    nextAt: new Date(s.nextAt),
    error: s.error,
    blockedAt: copyDate(s.blockedAt),
    startedAt: new Date(s.startedAt),
    finishedAt: copyDate(s.finishedAt),
    completed: s.completed.map((c) => ({ step: c.step, at: new Date(c.at) })),
  }
}

export class ProvisioningRun {
  readonly #s: RunSnapshot

  private constructor(s: RunSnapshot) {
    this.#s = copy(s)
    Object.freeze(this)
  }

  static start(applicationId: string, now: Date): ProvisioningRun {
    return new ProvisioningRun({
      applicationId,
      attempts: 0,
      nextAt: now,
      error: null,
      blockedAt: null,
      startedAt: now,
      finishedAt: null,
      completed: [],
    })
  }

  static restore(s: RunSnapshot): ProvisioningRun {
    return new ProvisioningRun(s)
  }

  get snapshot(): RunSnapshot {
    return copy(this.#s)
  }
  get applicationId(): string {
    return this.#s.applicationId
  }
  get attempts(): number {
    return this.#s.attempts
  }
  get nextAt(): Date {
    return new Date(this.#s.nextAt)
  }
  get error(): string | null {
    return this.#s.error
  }
  get blocked(): boolean {
    return this.#s.blockedAt !== null
  }
  get finished(): boolean {
    return this.#s.finishedAt !== null
  }

  #with(changes: Partial<RunSnapshot>): ProvisioningRun {
    return new ProvisioningRun({ ...this.#s, ...changes })
  }

  #done(step: StepName): boolean {
    return this.#s.completed.some((c) => c.step === step)
  }

  nextStep(order: readonly StepName[]): StepName | null {
    return order.find((step) => !this.#done(step)) ?? null
  }

  complete(step: StepName, now: Date): ProvisioningRun {
    if (this.#done(step)) return this
    return this.#with({
      completed: [...this.#s.completed, { step, at: now }],
      attempts: 0,
      nextAt: now,
    })
  }

  fail(failure: StepFailure, policy: RetryPolicy, now: Date): ProvisioningRun {
    const attempts = this.#s.attempts + 1
    if (this.finished) {
      return this.#with({
        attempts,
        error: failure.reason,
        nextAt: policy.backoff(attempts, now),
      })
    }
    const next = failure.blocked
      ? "blocked"
      : policy.afterFailure(attempts, now)
    return next === "blocked"
      ? this.#with({ attempts, error: failure.reason, blockedAt: now })
      : this.#with({ attempts, error: failure.reason, nextAt: next })
  }

  restart(policy: RetryPolicy, now: Date): ProvisioningRun {
    if (this.finished) throw new Error("cannot restart a finished run")
    const attempts = this.#s.attempts + 1
    const next =
      this.#s.error === RESTART_REASON
        ? "blocked"
        : policy.afterFailure(attempts, now)
    const base = { completed: [], attempts, error: RESTART_REASON }
    return next === "blocked"
      ? this.#with({ ...base, blockedAt: now })
      : this.#with({ ...base, nextAt: next })
  }

  retry(
    change: { username?: unknown; cohort?: unknown },
    now: Date
  ): ProvisioningRun {
    if (this.finished) throw new ApplicationRefusal("wrong_state")
    if (change.username !== undefined && this.#done("create_account"))
      throw new ApplicationRefusal("wrong_state", "username")
    if (change.cohort !== undefined && this.#done("create_account"))
      throw new ApplicationRefusal("wrong_state", "cohort")
    return this.#with({
      blockedAt: null,
      attempts: 0,
      error: null,
      nextAt: now,
    })
  }

  finish(now: Date): ProvisioningRun {
    for (const step of STEP_NAMES)
      if (!this.#done(step)) throw new Error(`step ${step} is not completed`)
    return this.#with({ finishedAt: now, attempts: 0, error: null })
  }

  isDue(now: Date): boolean {
    return !this.blocked && !this.finished && this.#s.nextAt <= now
  }
}
