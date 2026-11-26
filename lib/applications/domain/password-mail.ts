import type { RecordedActor } from "./application"
import type { PASSWORD_MAIL_EVENT_KINDS } from "./constants"

export type PasswordMailEvent = {
  id: number
  kind: (typeof PASSWORD_MAIL_EVENT_KINDS)[number]
  actor: RecordedActor
  changes: Record<string, unknown> | null
  at: Date
}

export type PasswordMailState = {
  lastSentAt: Date | null
  lastRequestedAt: Date | null
  /** Actor of the latest request that no later send has answered. */
  pendingRequest: RecordedActor | null
  /** Any expiry event recorded an automatic resend. */
  autoResendUsed: boolean
  /** An expiry was already recorded after the latest send. */
  expiryRecorded: boolean
  passwordSet: boolean
}

/** Folds the password mail events into a state. Orders by id, never by time. */
export function derivePasswordMail(
  events: readonly PasswordMailEvent[]
): PasswordMailState {
  const sorted = [...events].sort((a, b) => a.id - b.id)
  let lastSent: PasswordMailEvent | null = null
  let lastRequested: PasswordMailEvent | null = null
  let autoResendUsed = false
  let expiryRecorded = false
  let passwordSet = false
  for (const e of sorted) {
    switch (e.kind) {
      case "password_mail_sent":
        lastSent = e
        expiryRecorded = false
        break
      case "password_mail_requested":
        lastRequested = e
        break
      case "password_mail_expired":
        expiryRecorded = true
        if (e.changes?.auto_resent === true) autoResendUsed = true
        break
      case "password_set":
        passwordSet = true
        break
    }
  }
  return {
    lastSentAt: lastSent ? new Date(lastSent.at) : null,
    lastRequestedAt: lastRequested ? new Date(lastRequested.at) : null,
    pendingRequest:
      lastRequested && (!lastSent || lastRequested.id > lastSent.id)
        ? lastRequested.actor
        : null,
    autoResendUsed,
    expiryRecorded,
    passwordSet,
  }
}
