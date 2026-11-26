import {
  APPLICANT,
  Application,
  type Changed,
  type OpenChangeRequest,
} from "../domain/application"
import {
  ACTIVE_STATUSES,
  CLOSED_STATUSES,
  type AnonymousMailKind,
} from "../domain/constants"
import type { MailRatePolicy, RetentionPolicy } from "../domain/policies"
import { ApplicationRefusal } from "../domain/refusal"
import {
  ApplicantProfile,
  Email,
  parseRequestedStatus,
  type ProfileInput,
} from "../domain/values"
import {
  UnverifiedEmailTaken,
  type ApplicationStore,
  type Clock,
  type KeycloakDirectory,
  type ProcessorAuthority,
  type ReservedNames,
  type SettingsStore,
  type TokenGenerator,
  type TokenLookup,
  type UnitOfWork,
} from "../ports"
import type {
  ApplicationStatusView,
  ChangeRequestView,
  ConfirmResult,
  ConfirmSummaryView,
  EditView,
  MutationResult,
  OkResult,
  PasswordMailView,
  WithdrawResult,
} from "../views"
import type { MailComposer } from "./mail-composer"

export type SubmitForm = {
  email: string
  requestedStatus: string
  /** Parsed by ApplicantProfile.parse. */
  profile: Record<string, unknown>
}
/** The email never changes after submit. */
export type ResubmitPatch = {
  requestedStatus: string
  profile: Record<string, unknown>
}

type Deps = {
  store: ApplicationStore
  directory: KeycloakDirectory
  authority: ProcessorAuthority
  settings: SettingsStore
  reserved: ReservedNames
  mail: MailComposer
  tokens: TokenGenerator
  retention: RetentionPolicy
  rate: MailRatePolicy
  clock: Clock
  /** crypto.randomUUID in production; the domain makes no ids. */
  newId: () => string
}

// Form keys and the field names refusals carry.
const PROFILE_FIELDS: Record<keyof ProfileInput, string> = {
  username: "username",
  chineseName: "chinese_name",
  firstName: "first_name",
  lastName: "last_name",
  studentId: "student_id",
  birthday: "birthday",
  phone: "phone",
  nycuEmail: "nycu_email",
  department: "department",
  lineId: "line_id",
}
const OPTIONAL_FIELDS: readonly string[] = ["studentId", "nycuEmail"]

function profileInput(raw: Record<string, unknown>): ProfileInput {
  const out: Record<string, string | null> = {}
  for (const [key, field] of Object.entries(PROFILE_FIELDS)) {
    const v = raw[key]
    if (typeof v === "string") out[key] = v
    else if (OPTIONAL_FIELDS.includes(key) && (v === undefined || v === null))
      out[key] = null
    else throw new ApplicationRefusal("invalid_input", field)
  }
  return out as ProfileInput
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

function changeRequestView(c: OpenChangeRequest, now: Date): ChangeRequestView {
  return {
    note: c.note,
    dueAt: c.dueAt.toISOString(),
    expired: now.getTime() >= c.dueAt.getTime(),
  }
}

function requireEmail(app: Application): Email {
  if (!app.email) throw new Error(`application ${app.id} has no email`)
  return app.email
}

/**
 * What the apply site does for an applicant. A refusal that would also send
 * mail is returned as a result code, never thrown: throwing rolls the
 * transaction back and the mail with it. Every mail with a link carries a
 * new token.
 */
export class ApplicantService {
  constructor(private readonly d: Deps) {}

  async submit(form: SubmitForm): Promise<OkResult> {
    const email = Email.parse(form.email)
    const requestedStatus = parseRequestedStatus(form.requestedStatus)
    const profile = await ApplicantProfile.parse(
      profileInput(form.profile),
      this.d.reserved
    )
    const hasAccount = await this.d.directory.emailExists(email)
    const now = this.d.clock.now()
    return this.d.store.transaction(async (uow) => {
      // Before any row lock: sendLink takes the same two locks.
      await uow.lockMailLimit()
      // The kind must be known before the reservation.
      const active = hasAccount
        ? null
        : await uow.lockByEmail(email, ACTIVE_STATUSES)
      const kind: AnonymousMailKind = hasAccount
        ? "has_account"
        : active
          ? "link"
          : "verify"
      // Nothing is written yet, so throwing here loses no mail.
      if ((await uow.reserveMail(email, kind, now)) !== "ok")
        throw new ApplicationRefusal("rate_limited")
      if (hasAccount) {
        await uow.queueMail(null, this.d.mail.hasAccount(email))
      } else if (active) {
        await this.mailLink(uow, active, now)
      } else {
        await this.writeUnverified(
          uow,
          { email, requestedStatus, profile },
          now
        )
      }
      return { ok: true } as const
    })
  }

  async getForConfirm(token: string): Promise<ConfirmSummaryView> {
    const now = this.d.clock.now()
    const found = await this.d.store.reader.byToken(
      this.d.tokens.hash(token),
      "verify"
    )
    if (!found || !this.d.retention.verifyValid(found.tokenCreatedAt, now))
      throw new ApplicationRefusal("link_invalid")
    const app = found.application
    if (!app.profile) throw new ApplicationRefusal("link_invalid")
    const p = app.profile.fields
    return {
      chineseName: p.chineseName,
      firstName: p.firstName,
      lastName: p.lastName,
      studentId: p.studentId,
      department: p.department,
      requestedStatus: app.requestedStatus,
      username: p.username,
      phoneLast3: p.phone.slice(-3),
      confirmed: app.status !== "unverified",
    }
  }

  async confirm(token: string): Promise<ConfirmResult> {
    const hash = this.d.tokens.hash(token)
    const now = this.d.clock.now()
    return this.d.store.transaction(async (uow) => {
      const found = await uow.lockByToken(hash, "verify")
      if (!found || !this.d.retention.verifyValid(found.tokenCreatedAt, now))
        throw new ApplicationRefusal("link_invalid")
      const t = found.application.confirm(now)
      if (t.kind === "unchanged") return { ok: true, already: true }
      const email = requireEmail(t.next)
      const discard = found.application.id
      const other = await uow.lockByEmail(email, ACTIVE_STATUSES)
      if (other) return this.alreadyApplied(uow, other, discard, now)
      const saved = await uow.save(t)
      if (saved === "active_email_taken") {
        // A concurrent confirm got there first: handled the same way.
        const winner = await uow.lockByEmail(email, ACTIVE_STATUSES)
        if (!winner) throw new Error("active application vanished")
        return this.alreadyApplied(uow, winner, discard, now)
      }
      if (saved !== "ok") throw new Error(`confirm could not save: ${saved}`)
      const access = this.d.tokens.generate()
      await uow.putToken(t.next.id, "access", access.hash, now)
      await uow.queueMail(t.next.id, this.d.mail.received(
          t.next,
          access.token,
          await this.applySite()
        ))
      await this.notifyProcessors(uow, t.next)
      return { ok: true, already: false }
    })
  }

  async getStatus(token: string): Promise<ApplicationStatusView> {
    const now = this.d.clock.now()
    const found = await this.d.store.reader.byToken(
      this.d.tokens.hash(token),
      "access"
    )
    const app = this.accessible(found, now).application
    const releasedAt = found?.releasedAt ?? null
    let passwordMail: PasswordMailView | null = null
    if (app.status === "accepted") {
      const state = await this.d.store.reader.passwordMail(app.id)
      const passwordSet = state.passwordSet || releasedAt !== null
      passwordMail = {
        lastSentAt: iso(state.lastSentAt),
        expiresAt: state.lastSentAt
          ? this.d.retention
              .passwordMailExpiresAt(state.lastSentAt)
              .toISOString()
          : null,
        passwordSet,
        canResend:
          !passwordSet &&
          this.d.rate.passwordMailRequestAllowed(state.lastRequestedAt, now),
      }
    }
    const cr = app.changeRequest
    return {
      status: app.status,
      submittedAt: app.createdAt.toISOString(),
      verifiedAt: iso(app.verifiedAt),
      reviewedAt: iso(app.reviewedAt),
      closedAt: iso(app.closedAt),
      changeRequest: cr ? changeRequestView(cr, now) : null,
      closure: this.closure(app),
      passwordMail,
    }
  }

  async sendLink(rawEmail: string): Promise<OkResult> {
    const email = Email.parse(rawEmail)
    const now = this.d.clock.now()
    await this.d.store.transaction(async (uow) => {
      // Before any row lock: submit takes the same two locks.
      await uow.lockMailLimit()
      // Neither the limit nor whether the email is known is revealed.
      if ((await uow.reserveMail(email, "link", now)) !== "ok") return
      const target = await this.linkTarget(uow, email, now)
      if (target) await this.mailLink(uow, target, now)
    })
    return { ok: true }
  }

  async withdraw(token: string): Promise<WithdrawResult> {
    const hash = this.d.tokens.hash(token)
    const now = this.d.clock.now()
    return this.d.store.transaction(async (uow) => {
      const app = this.accessible(
        await uow.lockByToken(hash, "access"),
        now
      ).application
      const t = app.withdraw(now)
      if (t.kind === "changed") await this.save(uow, t)
      return { ok: true, status: "withdrawn" } as const
    })
  }

  async getForEdit(token: string): Promise<EditView> {
    const now = this.d.clock.now()
    const found = await this.d.store.reader.byToken(
      this.d.tokens.hash(token),
      "access"
    )
    const app = this.accessible(found, now).application
    if (app.status !== "changes_requested")
      throw new ApplicationRefusal("wrong_state")
    const cr = app.changeRequest
    if (!cr || !app.profile)
      throw new Error(`application ${app.id} has no change request or profile`)
    if (now.getTime() >= cr.dueAt.getTime())
      throw new ApplicationRefusal("edit_window_closed")
    return {
      profile: { ...app.profile.fields },
      requestedStatus: app.requestedStatus,
      changeRequest: changeRequestView(cr, now),
    }
  }

  async resubmit(token: string, patch: ResubmitPatch): Promise<MutationResult> {
    const requestedStatus = parseRequestedStatus(patch.requestedStatus)
    const profile = await ApplicantProfile.parse(
      profileInput(patch.profile),
      this.d.reserved
    )
    const hash = this.d.tokens.hash(token)
    const now = this.d.clock.now()
    return this.d.store.transaction(async (uow) => {
      const app = this.accessible(
        await uow.lockByToken(hash, "access"),
        now
      ).application
      const t = app.resubmit({ profile, requestedStatus }, now)
      if (t.kind === "unchanged") return { ok: true, version: app.version }
      await this.save(uow, t)
      await this.notifyProcessors(uow, t.next)
      return { ok: true, version: t.next.version }
    })
  }

  async requestPasswordMail(token: string): Promise<OkResult> {
    const hash = this.d.tokens.hash(token)
    const now = this.d.clock.now()
    return this.d.store.transaction(async (uow) => {
      const app = this.accessible(
        await uow.lockByToken(hash, "access"),
        now
      ).application
      if (app.status !== "accepted") throw new ApplicationRefusal("wrong_state")
      const run = await uow.lockRun(app.id)
      if (!run) throw new Error(`accepted application ${app.id} has no run`)
      if (run.released) throw new ApplicationRefusal("password_already_set")
      // Shared with processors: one request an hour, whoever asked.
      const state = await uow.passwordMail(app.id)
      if (!this.d.rate.passwordMailRequestAllowed(state.lastRequestedAt, now))
        throw new ApplicationRefusal("rate_limited")
      const next = run.requestMail(now)
      await uow.appendEvent(
        app.id,
        "password_mail_requested",
        null,
        APPLICANT,
        now
      )
      await uow.saveRun(next)
      return { ok: true } as const
    })
  }

  /** Missing setup is an error, not a refusal: no processor has set it yet. */
  private async applySite(): Promise<string> {
    const { url } = await this.d.settings.applySite()
    if (!url) throw new Error("申請網站網址尚未設定")
    return url
  }

  /** The lookup, if its access link is still valid. */
  private accessible(found: TokenLookup | null, now: Date): TokenLookup {
    if (
      !found ||
      !this.d.retention.accessValid(found.application, found.releasedAt, now)
    )
      throw new ApplicationRefusal("link_invalid")
    return found
  }

  private closure(app: Application): ApplicationStatusView["closure"] {
    switch (app.status) {
      case "withdrawn":
        return { kind: "withdrawn" }
      case "rejected":
        // Only closeHasAccount rejects without a review time.
        return app.reviewedAt === null
          ? { kind: "has_account" }
          : { kind: "rejected", note: app.reviewNote }
      default:
        return null
    }
  }

  /**
   * One unverified application per email: an earlier one is replaced, with
   * a new id and a new verify token, so its link stops working.
   */
  private async writeUnverified(
    uow: UnitOfWork,
    input: Omit<Parameters<typeof Application.submit>[0], "id">,
    now: Date
  ): Promise<void> {
    const write = async () => {
      const old = await uow.lockByEmail(input.email, ["unverified"])
      if (old) await uow.delete(old.id)
      const t = Application.submit({ id: this.d.newId(), ...input }, now)
      await this.save(uow, t)
      return t.next
    }
    let app: Application
    try {
      app = await uow.savepoint(write)
    } catch (error) {
      if (!(error instanceof UnverifiedEmailTaken)) throw error
      // A concurrent submit wrote one first: replace it, once.
      app = await uow.savepoint(write)
    }
    const verify = this.d.tokens.generate()
    await uow.putToken(app.id, "verify", verify.hash, now)
    await uow.queueMail(app.id, this.d.mail.verify(
        input.email,
        verify.token,
        await this.applySite()
      ))
  }

  /**
   * The newest application the email may still follow: an active one, or a
   * closed one whose access link is still valid.
   */
  private async linkTarget(
    uow: UnitOfWork,
    email: Email,
    now: Date
  ): Promise<Application | null> {
    const active = await uow.lockByEmail(email, ACTIVE_STATUSES)
    if (active) return active
    const closed = await uow.lockByEmail(email, CLOSED_STATUSES)
    if (!closed) return null
    const run = await uow.lockRun(closed.id)
    const releasedAt = run?.releasedAt ?? null
    return this.d.retention.accessValid(closed, releasedAt, now) ? closed : null
  }

  private async mailLink(
    uow: UnitOfWork,
    app: Application,
    now: Date
  ): Promise<void> {
    const access = this.d.tokens.generate()
    await uow.putToken(app.id, "access", access.hash, now)
    await uow.queueMail(
      app.id,
      this.d.mail.link(
        requireEmail(app),
        access.token,
        await this.applySite()
      )
    )
    await uow.appendEvent(app.id, "link_sent", null, APPLICANT, now)
  }

  /** Mails the active application its link and drops the unverified one. */
  private async alreadyApplied(
    uow: UnitOfWork,
    other: Application,
    discard: string,
    now: Date
  ) {
    await this.mailLink(uow, other, now)
    await uow.delete(discard)
    // Returned, not thrown: the mail must commit.
    return { ok: false, code: "already_applied" } as const
  }

  private async notifyProcessors(uow: UnitOfWork, app: Application) {
    for (const to of await this.d.authority.processorEmails())
      await uow.queueMail(app.id, this.d.mail.processorNotice(app, to))
  }

  private async save(uow: UnitOfWork, t: Changed): Promise<void> {
    const saved = await uow.save(t)
    if (saved === "username_claimed")
      throw new ApplicationRefusal("invalid_input", "username")
    if (saved !== "ok") throw new Error(`save failed: ${saved}`)
  }
}
