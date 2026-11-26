import type { Application, EventActor } from "../domain/application"
import type { PasswordMailState } from "../domain/password-mail"
import type { MailRatePolicy, RetentionPolicy } from "../domain/policies"
import { ApplicationRefusal } from "../domain/refusal"
import type { UnitOfWork } from "../ports"
import type { PasswordMailView } from "../views"

/**
 * The applicant asking for a new password mail and a processor asking for
 * one go through this function: one request an hour, whoever asked. Call it
 * inside the transaction that holds the application's lock.
 */
export async function requestPasswordMail(
  uow: UnitOfWork,
  rate: MailRatePolicy,
  app: Application,
  actor: EventActor,
  now: Date
): Promise<void> {
  if (app.status !== "accepted") throw new ApplicationRefusal("wrong_state")
  const run = await uow.lockRun(app.id)
  if (!run) throw new Error(`accepted application ${app.id} has no run`)
  if (run.released) throw new ApplicationRefusal("password_already_set")
  const state = await uow.passwordMail(app.id)
  if (!rate.passwordMailRequestAllowed(state.lastRequestedAt, now))
    throw new ApplicationRefusal("rate_limited")
  const next = run.requestMail(now)
  await uow.appendEvent(app.id, "password_mail_requested", null, actor, now)
  await uow.saveRun(next)
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

/** What an applicant or a processor sees of the password mail. */
export function passwordMailView(
  state: PasswordMailState,
  releasedAt: Date | null,
  retention: RetentionPolicy,
  rate: MailRatePolicy,
  now: Date
): PasswordMailView {
  const passwordSet = state.passwordSet || releasedAt !== null
  return {
    lastSentAt: iso(state.lastSentAt),
    expiresAt: state.lastSentAt
      ? retention.passwordMailExpiresAt(state.lastSentAt).toISOString()
      : null,
    passwordSet,
    canResend:
      !passwordSet &&
      rate.passwordMailRequestAllowed(state.lastRequestedAt, now),
  }
}
