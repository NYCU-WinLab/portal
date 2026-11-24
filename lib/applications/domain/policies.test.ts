import { expect, test } from "bun:test"
import { ApplicationRefusal } from "./refusal"
import {
  LabStatusPolicy,
  MailRatePolicy,
  RetentionPolicy,
  RetryPolicy,
} from "./policies"

const T = new Date("2026-11-24T02:00:00Z"),
  at = (ms: number) => new Date(T.getTime() + ms)
const SEC = 1000,
  MIN = 60 * SEC,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR

test("processors assign master or doctoral; portal admins also teacher, assistant, undergrad", () => {
  const p = new LabStatusPolicy()
  expect(p.assignable({ isPortalAdmin: false })).toEqual(["master", "doctoral"])
  expect([...p.assignable({ isPortalAdmin: true })].sort()).toEqual([
    "assistant",
    "doctoral",
    "master",
    "teacher",
    "undergrad",
  ])
  expect(() => p.check("teacher", { isPortalAdmin: false })).toThrow(
    new ApplicationRefusal("status_not_allowed")
  )
  expect(p.defaultFor("doctoral")).toBe("doctoral")
})

test.each([
  [
    "verifyValid",
    (r: RetentionPolicy, now: Date) => r.verifyValid(T, now),
    DAY,
    true,
  ],
  [
    "autoRejectDue",
    (r: RetentionPolicy, now: Date) => r.autoRejectDue(T, now),
    14 * DAY,
    false,
  ],
  [
    "purgeDue",
    (r: RetentionPolicy, now: Date) => r.purgeDue(T, now),
    90 * DAY,
    false,
  ],
  [
    "digestOverdue",
    (r: RetentionPolicy, now: Date) => r.digestOverdue(T, now),
    3 * DAY,
    false,
  ],
])("%s flips at its threshold", (_, check, threshold, before) => {
  const r = new RetentionPolicy()
  expect(check(r, at(threshold - SEC))).toBe(before)
  expect(check(r, at(threshold))).toBe(!before)
})

test("access link: open always, accepted until 30 days after release, closed until 30 days after closing", () => {
  const r = new RetentionPolicy(),
    late = at(31 * DAY)
  expect(
    r.accessValid(
      { status: "provisioning", closedAt: null, purgedAt: null },
      null,
      late
    )
  ).toBe(true)
  expect(
    r.accessValid(
      { status: "accepted", closedAt: T, purgedAt: null },
      null,
      at(365 * DAY)
    )
  ).toBe(true)
  expect(
    r.accessValid(
      { status: "accepted", closedAt: T, purgedAt: null },
      T,
      at(30 * DAY - SEC)
    )
  ).toBe(true)
  expect(
    r.accessValid(
      { status: "accepted", closedAt: T, purgedAt: null },
      T,
      at(30 * DAY)
    )
  ).toBe(false)
  expect(
    r.accessValid(
      { status: "withdrawn", closedAt: T, purgedAt: null },
      null,
      at(30 * DAY)
    )
  ).toBe(false)
  expect(
    r.accessValid(
      { status: "rejected", closedAt: T, purgedAt: T },
      null,
      at(SEC)
    )
  ).toBe(false)
  expect(
    r.accessValid(
      { status: "unverified", closedAt: null, purgedAt: null },
      null,
      T
    )
  ).toBe(false)
})

test("other retention values", () => {
  const r = new RetentionPolicy()
  expect(r.changesDue(T)).toEqual(at(7 * DAY))
  expect(r.passwordMailExpiresAt(T)).toEqual(at(7 * DAY))
  expect(r.passwordMailLifespanSeconds()).toBe(604_800)
  expect(r.nextPasswordCheck(T)).toEqual(at(15 * MIN))
  expect(r.mailLogCutoff(T)).toEqual(at(-2 * DAY))
  expect(r.cohortAlertNotBefore(T)).toEqual(at(-DAY))
  expect(
    new RetentionPolicy({ verifyTtlMs: MIN }).verifyValid(T, at(MIN))
  ).toBe(false)
})

test.each([
  [1, MIN],
  [2, 5 * MIN],
  [3, 15 * MIN],
  [4, HOUR],
  [5, HOUR],
  [6, "blocked"],
])("failure %p → %p", (n, expected) => {
  const out = new RetryPolicy().afterFailure(n, T)
  expect(out).toEqual(
    expected === "blocked" ? "blocked" : at(expected as number)
  )
})
test("backoff never blocks", () =>
  expect(new RetryPolicy().backoff(9, T)).toEqual(at(HOUR)))

test.each([
  [{ recipientLastHour: 0, recipientLastDay: 0, keyLastHour: 0 }, "ok"],
  [
    { recipientLastHour: 1, recipientLastDay: 1, keyLastHour: 1 },
    "recipient_limit",
  ],
  [
    { recipientLastHour: 0, recipientLastDay: 3, keyLastHour: 3 },
    "recipient_limit",
  ],
  [{ recipientLastHour: 0, recipientLastDay: 2, keyLastHour: 30 }, "key_limit"],
  [
    { recipientLastHour: 1, recipientLastDay: 1, keyLastHour: 30 },
    "recipient_limit",
  ],
])("allows(%p) = %p", (counts, expected) =>
  expect(new MailRatePolicy().allows(counts)).toBe(expected)
)
test("one password mail request per hour", () => {
  const p = new MailRatePolicy()
  expect(p.passwordMailRequestAllowed(null, T)).toBe(true)
  expect(p.passwordMailRequestAllowed(T, at(HOUR - SEC))).toBe(false)
  expect(p.passwordMailRequestAllowed(T, at(HOUR))).toBe(true)
})
