import { describe, expect, test } from "bun:test"
import { NOW } from "../testing/fixtures"
import { STEP_NAMES } from "./constants"
import { RetryPolicy } from "./policies"
import { ApplicationRefusal } from "./refusal"
import { ProvisioningRun, RESTART_REASON } from "./provisioning-run"

const MIN = 60_000
const policy = new RetryPolicy()
const started = () => ProvisioningRun.start("app-1", NOW)
const transient = { blocked: false, reason: "Keycloak 逾時" }
const allDone = () =>
  STEP_NAMES.reduce((run, step) => run.complete(step, NOW), started())
const finished = () => allDone().finish(NOW, new Date(NOW.getTime() + MIN))
const refusal = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return (e as ApplicationRefusal).message
  }
  return null
}

describe("ProvisioningRun", () => {
  test("start is due now with no attempts", () => {
    const run = started()
    expect([run.attempts, run.error, run.blocked, run.finished]).toEqual([
      0,
      null,
      false,
      false,
    ])
    expect(run.nextAt).toEqual(NOW)
    expect(run.isDue(NOW)).toBe(true)
  })

  test("nextStep returns the first step not completed", () =>
    expect(started().complete("create_account", NOW).nextStep(STEP_NAMES)).toBe(
      "join_keycloak_groups"
    ))

  test("nextStep is null when everything is completed", () =>
    expect(allDone().nextStep(STEP_NAMES)).toBeNull())

  test("completing a step twice returns the same run", () => {
    const run = started().complete("create_account", NOW)
    expect(run.complete("create_account", NOW)).toBe(run)
  })

  test("failures back off 1, 5, 15, 60, 60 minutes and block on the 6th", () => {
    let run = started()
    const gaps: (number | "blocked")[] = []
    for (let i = 0; i < 6; i++) {
      run = run.fail(transient, policy, NOW)
      gaps.push(
        run.blocked ? "blocked" : (run.nextAt.getTime() - NOW.getTime()) / MIN
      )
    }
    expect(gaps).toEqual([1, 5, 15, 60, 60, "blocked"])
  })

  test("a blocked failure blocks at once", () => {
    const run = started().fail(
      { blocked: true, reason: "群組不存在" },
      policy,
      NOW
    )
    expect(run.blocked).toBe(true)
    expect(run.error).toBe("群組不存在")
    expect(run.isDue(new Date(NOW.getTime() + 999 * MIN))).toBe(false)
  })

  test("complete resets attempts but keeps the last error", () => {
    const run = started()
      .fail(transient, policy, NOW)
      .complete("create_account", NOW)
    expect([run.attempts, run.error]).toEqual([0, "Keycloak 逾時"])
    expect(run.nextAt).toEqual(NOW)
  })

  test("restart counts as a failure, clears steps, and blocks when the last failure was a restart", () => {
    const once = started().complete("create_account", NOW).restart(policy, NOW)
    expect([once.attempts, once.nextStep(STEP_NAMES), once.blocked]).toEqual([
      1,
      "create_account",
      false,
    ])
    expect(once.error).toBe(RESTART_REASON)
    expect(
      once.complete("create_account", NOW).restart(policy, NOW).blocked
    ).toBe(true)
  })

  test("restart on a finished run is an error", () =>
    expect(() => finished().restart(policy, NOW)).toThrow())

  test("a finished run never blocks and backs off at most 60 minutes", () => {
    let run = finished()
    for (let i = 0; i < 10; i++)
      run = run.fail({ blocked: true, reason: "x" }, policy, NOW)
    expect(run.blocked).toBe(false)
    expect(run.nextAt.getTime() - NOW.getTime()).toBe(60 * MIN)
  })

  test("retry unblocks; username only before create_account, cohort only before join_keycloak_groups", () => {
    const blocked = started().fail({ blocked: true, reason: "x" }, policy, NOW)
    const later = new Date(NOW.getTime() + 5 * MIN)
    const r = blocked.retry({ username: "new" }, later)
    expect([r.blocked, r.attempts, r.error]).toEqual([false, 0, null])
    expect(r.nextAt).toEqual(later)

    const afterAccount = blocked.complete("create_account", NOW)
    expect(refusal(() => afterAccount.retry({ username: "n" }, NOW))).toBe(
      "wrong_state:username"
    )
    expect(() => afterAccount.retry({ cohort: "113" }, NOW)).not.toThrow()

    const afterGroups = afterAccount.complete("join_keycloak_groups", NOW)
    expect(refusal(() => afterGroups.retry({ cohort: "113" }, NOW))).toBe(
      "wrong_state:cohort"
    )
    expect(() => afterGroups.retry({}, NOW)).not.toThrow()
  })

  test("retry on a finished run is wrong_state", () =>
    expect(refusal(() => finished().retry({}, NOW))).toBe("wrong_state"))

  test("finish requires every step and schedules the first check", () => {
    expect(() => started().finish(NOW, NOW)).toThrow()
    const first = new Date(NOW.getTime() + 15 * MIN)
    const run = allDone().finish(NOW, first)
    expect([run.finished, run.attempts, run.error]).toEqual([true, 0, null])
    expect(run.nextAt).toEqual(first)
    expect(run.snapshot.finishedAt).toEqual(NOW)
  })

  test("requestMail needs a finished, unreleased run", () => {
    const later = new Date(NOW.getTime() + MIN)
    expect(refusal(() => started().requestMail(NOW))).toBe("wrong_state")
    expect(finished().requestMail(later).nextAt).toEqual(later)
    expect(refusal(() => finished().release(NOW).requestMail(NOW))).toBe(
      "password_already_set"
    )
  })

  test("scheduleCheck needs a finished run", () => {
    const at = new Date(NOW.getTime() + 3 * MIN)
    expect(() => started().scheduleCheck(at)).toThrow()
    expect(finished().scheduleCheck(at).nextAt).toEqual(at)
  })

  test("release needs a finished run and is idempotent", () => {
    expect(() => started().release(NOW)).toThrow()
    const released = finished().release(NOW)
    expect([released.released, released.releasedAt]).toEqual([true, NOW])
    expect(released.release(new Date(NOW.getTime() + MIN))).toBe(released)
  })

  test("isDue is false when blocked, released or not yet due", () => {
    const later = new Date(NOW.getTime() + 10 * MIN)
    const blocked = started().fail({ blocked: true, reason: "x" }, policy, NOW)
    expect(blocked.isDue(later)).toBe(false)
    expect(finished().release(NOW).isDue(later)).toBe(false)
    const waiting = started().fail(transient, policy, NOW)
    expect(waiting.isDue(NOW)).toBe(false)
    expect(waiting.isDue(new Date(NOW.getTime() + MIN))).toBe(true)
  })

  test("restore round-trips a snapshot", () => {
    const run = started().fail(transient, policy, NOW)
    expect(ProvisioningRun.restore(run.snapshot).snapshot).toEqual(run.snapshot)
  })

  test("returned dates and arrays are copies", () => {
    const run = started().complete("create_account", NOW)
    const snap = run.snapshot
    ;(snap.completed as { step: string; at: Date }[]).pop()
    snap.nextAt.setFullYear(2000)
    snap.completed[0]?.at.setFullYear(2000)
    run.nextAt.setFullYear(2000)
    expect(run.nextAt).toEqual(NOW)
    expect(run.snapshot.completed).toEqual([
      { step: "create_account", at: NOW },
    ])
  })
})
