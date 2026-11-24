import { ApplicationRefusal } from "./refusal"
import type { ApplicationStatus, LabStatus, RequestedStatus } from "./constants"

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const shift = (d: Date, ms: number) => new Date(d.getTime() + ms)
const elapsed = (from: Date, now: Date) => now.getTime() - from.getTime()

export class LabStatusPolicy {
  defaultFor(requested: RequestedStatus): LabStatus {
    return requested
  }

  assignable(actor: { isPortalAdmin: boolean }): readonly LabStatus[] {
    return actor.isPortalAdmin
      ? ["master", "doctoral", "teacher", "assistant", "undergrad"]
      : ["master", "doctoral"]
  }

  check(status: LabStatus, actor: { isPortalAdmin: boolean }): void {
    if (!this.assignable(actor).includes(status))
      throw new ApplicationRefusal("status_not_allowed")
  }
}

export type RetentionSettings = {
  verifyTtlMs: number
  changesWindowMs: number
  autoRejectAfterDueMs: number
  accessAfterCloseMs: number
  purgeAfterCloseMs: number
  digestAfterMs: number
  passwordMailTtlMs: number
  passwordCheckMs: number
  mailLogMs: number
  cohortAlertMs: number
}

const RETENTION_DEFAULTS: RetentionSettings = {
  verifyTtlMs: DAY,
  changesWindowMs: 7 * DAY,
  autoRejectAfterDueMs: 14 * DAY,
  accessAfterCloseMs: 30 * DAY,
  purgeAfterCloseMs: 90 * DAY,
  digestAfterMs: 3 * DAY,
  passwordMailTtlMs: 7 * DAY,
  passwordCheckMs: 15 * MINUTE,
  mailLogMs: 2 * DAY,
  cohortAlertMs: DAY,
}

// "Valid" means elapsed < threshold; "due" means elapsed >= threshold.
export class RetentionPolicy {
  readonly settings: Readonly<RetentionSettings>

  constructor(overrides: Partial<RetentionSettings> = {}) {
    this.settings = Object.freeze({ ...RETENTION_DEFAULTS, ...overrides })
  }

  verifyValid(tokenCreatedAt: Date, now: Date): boolean {
    return elapsed(tokenCreatedAt, now) < this.settings.verifyTtlMs
  }

  changesDue(now: Date): Date {
    return shift(now, this.settings.changesWindowMs)
  }

  autoRejectDue(dueAt: Date, now: Date): boolean {
    return elapsed(dueAt, now) >= this.settings.autoRejectAfterDueMs
  }

  accessValid(
    a: {
      status: ApplicationStatus
      closedAt: Date | null
      purgedAt: Date | null
    },
    releasedAt: Date | null,
    now: Date
  ): boolean {
    if (a.purgedAt) return false
    const within = (from: Date) =>
      elapsed(from, now) < this.settings.accessAfterCloseMs
    switch (a.status) {
      case "unverified":
        return false
      case "pending":
      case "changes_requested":
      case "provisioning":
        return true
      case "accepted":
        return releasedAt ? within(releasedAt) : true
      case "rejected":
      case "withdrawn":
        return a.closedAt ? within(a.closedAt) : false
    }
  }

  purgeDue(closedAt: Date, now: Date): boolean {
    return elapsed(closedAt, now) >= this.settings.purgeAfterCloseMs
  }

  digestOverdue(verifiedAt: Date, now: Date): boolean {
    return elapsed(verifiedAt, now) >= this.settings.digestAfterMs
  }

  passwordMailExpiresAt(sentAt: Date): Date {
    return shift(sentAt, this.settings.passwordMailTtlMs)
  }

  passwordMailLifespanSeconds(): number {
    return Math.floor(this.settings.passwordMailTtlMs / SECOND)
  }

  nextPasswordCheck(now: Date): Date {
    return shift(now, this.settings.passwordCheckMs)
  }

  mailLogCutoff(now: Date): Date {
    return shift(now, -this.settings.mailLogMs)
  }

  cohortAlertNotBefore(now: Date): Date {
    return shift(now, -this.settings.cohortAlertMs)
  }
}

export class RetryPolicy {
  private readonly delaysMs: readonly number[]
  private readonly maxAttempts: number

  constructor(
    overrides: { delaysMs?: readonly number[]; maxAttempts?: number } = {}
  ) {
    this.delaysMs = [
      ...(overrides.delaysMs ?? [MINUTE, 5 * MINUTE, 15 * MINUTE, HOUR]),
    ]
    this.maxAttempts = overrides.maxAttempts ?? 6
  }

  /** `attempts` counts failures including this one. */
  afterFailure(attempts: number, now: Date): Date | "blocked" {
    return attempts >= this.maxAttempts
      ? "blocked"
      : this.backoff(attempts, now)
  }

  /** Never blocks; past the end of the list the last delay repeats. */
  backoff(attempts: number, now: Date): Date {
    const i = Math.min(Math.max(attempts, 1), this.delaysMs.length) - 1
    return shift(now, this.delaysMs[i])
  }
}

export type MailCounts = {
  recipientLastHour: number
  recipientLastDay: number
  keyLastHour: number
}

export type MailRateSettings = {
  recipientPerHour: number
  recipientPerDay: number
  keyPerHour: number
  passwordMailRequestMs: number
}

const MAIL_RATE_DEFAULTS: MailRateSettings = {
  recipientPerHour: 1,
  recipientPerDay: 3,
  keyPerHour: 30,
  passwordMailRequestMs: HOUR,
}

export class MailRatePolicy {
  readonly hourMs = 3_600_000 as const
  readonly dayMs = 86_400_000 as const
  private readonly settings: MailRateSettings

  constructor(overrides: Partial<MailRateSettings> = {}) {
    this.settings = { ...MAIL_RATE_DEFAULTS, ...overrides }
  }

  /** `counts` are the mails already sent before this one; recipient first. */
  allows(counts: MailCounts): "ok" | "recipient_limit" | "key_limit" {
    if (
      counts.recipientLastHour >= this.settings.recipientPerHour ||
      counts.recipientLastDay >= this.settings.recipientPerDay
    )
      return "recipient_limit"
    if (counts.keyLastHour >= this.settings.keyPerHour) return "key_limit"
    return "ok"
  }

  passwordMailRequestAllowed(lastRequestedAt: Date | null, now: Date): boolean {
    return (
      lastRequestedAt === null ||
      elapsed(lastRequestedAt, now) >= this.settings.passwordMailRequestMs
    )
  }
}
