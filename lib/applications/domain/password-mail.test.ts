import { describe, expect, test } from "bun:test"
import { NOW } from "../testing/fixtures"
import { APPLICANT, SYSTEM, type EventActor } from "./application"
import { derivePasswordMail, type PasswordMailEvent } from "./password-mail"

const ev = (
  id: number,
  kind: PasswordMailEvent["kind"],
  changes: Record<string, unknown> | null = null,
  actor: EventActor = SYSTEM
): PasswordMailEvent => ({ id, kind, actor, changes, at: NOW })

describe("derivePasswordMail", () => {
  test("no events: nothing sent, nothing pending", () =>
    expect(derivePasswordMail([])).toEqual({
      lastSentAt: null,
      lastRequestedAt: null,
      pendingRequest: null,
      autoResendUsed: false,
      expiryRecorded: false,
      passwordSet: false,
    }))

  test("a request after the latest send is pending, ordered by id not time", () => {
    expect(
      derivePasswordMail([
        ev(2, "password_mail_requested", null, APPLICANT),
        ev(1, "password_mail_sent", { trigger: "approval" }),
      ]).pendingRequest
    ).toEqual(APPLICANT)
    expect(
      derivePasswordMail([
        ev(1, "password_mail_requested", null, APPLICANT),
        ev(2, "password_mail_sent", { trigger: "applicant" }),
      ]).pendingRequest
    ).toBeNull()
  })

  test("a request with no send at all is pending", () =>
    expect(
      derivePasswordMail([ev(1, "password_mail_requested", null, APPLICANT)])
        .pendingRequest
    ).toEqual(APPLICANT))

  test("an auto resend uses the one auto resend and starts a fresh expiry", () => {
    const s = derivePasswordMail([
      ev(1, "password_mail_sent", { trigger: "approval" }),
      ev(2, "password_mail_expired", { auto_resent: true }),
      ev(3, "password_mail_sent", { trigger: "auto" }),
    ])
    expect([s.autoResendUsed, s.expiryRecorded]).toEqual([true, false])
  })

  test("an expiry without auto resend is recorded once", () => {
    const s = derivePasswordMail([
      ev(1, "password_mail_sent", { trigger: "approval" }),
      ev(2, "password_mail_expired", { auto_resent: false }),
    ])
    expect([s.autoResendUsed, s.expiryRecorded]).toEqual([false, true])
  })

  test("password_set sets passwordSet", () =>
    expect(
      derivePasswordMail([ev(1, "password_mail_sent"), ev(2, "password_set")])
        .passwordSet
    ).toBe(true))

  test("lastSentAt and lastRequestedAt come from the latest events", () => {
    const t = (n: number) => new Date(NOW.getTime() + n)
    const s = derivePasswordMail([
      { ...ev(1, "password_mail_sent"), at: t(1) },
      { ...ev(2, "password_mail_sent"), at: t(2) },
      { ...ev(3, "password_mail_requested"), at: t(3) },
    ])
    expect([s.lastSentAt, s.lastRequestedAt]).toEqual([t(2), t(3)])
  })
})
