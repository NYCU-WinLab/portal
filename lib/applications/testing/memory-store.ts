import { AsyncLocalStorage } from "node:async_hooks"
import {
  Application,
  type ApplicationSnapshot,
  type Changed,
  type EventActor,
  type RecordedActor,
  type OpenChangeRequest,
} from "../domain/application"
import {
  ACTIVE_STATUSES,
  PASSWORD_MAIL_EVENT_KINDS,
  type AnonymousMailKind,
  type ApplicationStatus,
  type EventKind,
  type LabStatus,
  type RequestedStatus,
  type StepName,
  type TokenPurpose,
} from "../domain/constants"
import {
  derivePasswordMail,
  type PasswordMailEvent,
  type PasswordMailState,
} from "../domain/password-mail"
import { MailRatePolicy } from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import {
  ApplicantProfile,
  Cohort,
  Email,
  Username,
  type ProfileFields,
  type TokenHash,
} from "../domain/values"
import { UnverifiedEmailTaken } from "../ports"
import type {
  ApplicationReader,
  ApplicationStore,
  ComposedMail,
  EventRecord,
  HistoryRow,
  ReviewRow,
  SaveResult,
  SettingsStore,
  TokenLookup,
  UnitOfWork,
} from "../ports"

export type QueuedMail = {
  mailId: string
  applicationId: string | null
  mail: ComposedMail
}

// Rows mirror the Postgres tables and hold only primitives and Dates, so a
// transaction can snapshot the whole state with structuredClone.

type ApplicationRow = {
  id: string
  status: ApplicationStatus
  version: number
  email: string | null
  requestedStatus: RequestedStatus
  assignedStatus: LabStatus | null
  assignedCohort: number | null
  assignedUsername: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  keycloakId: string | null
  createdAt: Date
  verifiedAt: Date | null
  closedAt: Date | null
  purgedAt: Date | null
}
type ChangeRequestRow = {
  id: number
  applicationId: string
  note: string | null
  requestedBy: string | null
  requestedAt: Date
  dueAt: Date
  endedAt: Date | null
}
type MailGroupRow = {
  applicationId: string
  groupId: string
  addedAt: Date | null
}
type EventRow = {
  id: number
  applicationId: string
  kind: EventKind
  actorKind: EventActor["kind"]
  actorId: string | null
  changes: Record<string, unknown> | null
  at: Date
}
type TokenRow = {
  applicationId: string
  purpose: TokenPurpose
  hash: string
  createdAt: Date
}
type RunRow = {
  applicationId: string
  attempts: number
  nextAt: Date
  error: string | null
  blockedAt: Date | null
  startedAt: Date
  finishedAt: Date | null
  releasedAt: Date | null
}
type StepRow = { applicationId: string; step: StepName; at: Date }
type MailLogRow = { rateKey: string; kind: AnonymousMailKind; at: Date }

type State = {
  applications: ApplicationRow[]
  profiles: { applicationId: string; fields: ProfileFields }[]
  changeRequests: ChangeRequestRow[]
  mailGroups: MailGroupRow[]
  events: EventRow[]
  tokens: TokenRow[]
  runs: RunRow[]
  steps: StepRow[]
  outbox: QueuedMail[]
  mailLog: MailLogRow[]
  alerts: { key: string; sentAt: Date }[]
  nextEventId: number
  nextChangeRequestId: number
}

function emptyState(): State {
  return {
    applications: [],
    profiles: [],
    changeRequests: [],
    mailGroups: [],
    events: [],
    tokens: [],
    runs: [],
    steps: [],
    outbox: [],
    mailLog: [],
    alerts: [],
    nextEventId: 1,
    nextChangeRequestId: 1,
  }
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const OPEN_STATUSES: readonly ApplicationStatus[] = ACTIVE_STATUSES
const isActive = (s: ApplicationStatus) => OPEN_STATUSES.includes(s)
const copyDate = (d: Date) => new Date(d.getTime())
const copyOptionalDate = (d: Date | null) => (d ? copyDate(d) : null)
const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime()
// Only the form Postgres reads back; any other spelling is refused.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const ABORTED =
  "current transaction is aborted, commands ignored until end of transaction block"

function sameProfile(a: ProfileFields, b: ProfileFields): boolean {
  return (Object.keys(a) as (keyof ProfileFields)[]).every((k) => a[k] === b[k])
}

function actorOf(row: EventRow): RecordedActor {
  if (row.actorKind === "admin") return { kind: "admin", id: row.actorId }
  return { kind: row.actorKind }
}

function eventRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    kind: row.kind,
    actor: actorOf(row),
    changes: row.changes === null ? null : structuredClone(row.changes),
    at: copyDate(row.at),
  }
}

/**
 * Reads and writes one `State`. A transaction works on a copy and replaces
 * the committed state only when its work succeeds.
 */
class Tables {
  constructor(readonly s: State) {}

  row(id: string): ApplicationRow | undefined {
    return this.s.applications.find((a) => a.id === id)
  }

  requireRow(id: string): ApplicationRow {
    const row = this.row(id)
    if (!row) throw new Error(`application ${id} does not exist`)
    return row
  }

  application(id: string): Application | null {
    const row = this.row(id)
    if (!row) return null
    const profile = this.s.profiles.find((p) => p.applicationId === id)
    const open = this.s.changeRequests.find(
      (c) => c.applicationId === id && c.endedAt === null
    )
    const changeRequest: OpenChangeRequest | null = open
      ? {
          note: open.note,
          requestedBy: open.requestedBy,
          requestedAt: copyDate(open.requestedAt),
          dueAt: copyDate(open.dueAt),
        }
      : null
    const assignment =
      row.assignedStatus !== null &&
      row.assignedCohort !== null &&
      row.assignedUsername !== null
        ? {
            status: row.assignedStatus,
            cohort: Cohort.restore(row.assignedCohort),
            username: Username.restore(row.assignedUsername),
            mailGroups: this.s.mailGroups
              .filter((g) => g.applicationId === id)
              .sort((x, y) =>
                x.groupId < y.groupId ? -1 : x.groupId > y.groupId ? 1 : 0
              )
              .map((g) => ({
                groupId: g.groupId,
                addedAt: copyOptionalDate(g.addedAt),
              })),
          }
        : null
    const snapshot: ApplicationSnapshot = {
      id: row.id,
      status: row.status,
      version: row.version,
      email: row.email === null ? null : Email.restore(row.email),
      requestedStatus: row.requestedStatus,
      profile: profile ? ApplicantProfile.restore({ ...profile.fields }) : null,
      assignment,
      reviewedBy: row.reviewedBy,
      reviewedAt: copyOptionalDate(row.reviewedAt),
      reviewNote: row.reviewNote,
      keycloakId: row.keycloakId,
      changeRequest,
      createdAt: copyDate(row.createdAt),
      verifiedAt: copyOptionalDate(row.verifiedAt),
      closedAt: copyOptionalDate(row.closedAt),
      purgedAt: copyOptionalDate(row.purgedAt),
    }
    return Application.restore(snapshot)
  }

  run(applicationId: string): ProvisioningRun | null {
    const row = this.s.runs.find((r) => r.applicationId === applicationId)
    if (!row) return null
    return ProvisioningRun.restore({
      applicationId: row.applicationId,
      attempts: row.attempts,
      nextAt: copyDate(row.nextAt),
      error: row.error,
      blockedAt: copyOptionalDate(row.blockedAt),
      startedAt: copyDate(row.startedAt),
      finishedAt: copyOptionalDate(row.finishedAt),
      releasedAt: copyOptionalDate(row.releasedAt),
      completed: this.s.steps
        .filter((st) => st.applicationId === applicationId)
        .map((st) => ({ step: st.step, at: copyDate(st.at) })),
    })
  }

  byToken(hash: TokenHash, purpose: TokenPurpose): TokenLookup | null {
    const token = this.s.tokens.find(
      (t) => t.hash === hash.value && t.purpose === purpose
    )
    if (!token) return null
    const application = this.application(token.applicationId)
    if (!application) return null
    const run = this.s.runs.find((r) => r.applicationId === token.applicationId)
    return {
      application,
      tokenCreatedAt: copyDate(token.createdAt),
      releasedAt: run ? copyOptionalDate(run.releasedAt) : null,
    }
  }

  events(applicationId: string): EventRecord[] {
    return this.s.events
      .filter((e) => e.applicationId === applicationId)
      .sort((a, b) => a.id - b.id)
      .map(eventRecord)
  }

  passwordMail(applicationId: string): PasswordMailState {
    const kinds: readonly EventKind[] = PASSWORD_MAIL_EVENT_KINDS
    const events = this.events(applicationId).filter((e) =>
      kinds.includes(e.kind)
    ) as PasswordMailEvent[]
    return derivePasswordMail(events)
  }

  history(email: string, exceptId: string): HistoryRow[] {
    return this.s.applications
      .filter(
        (a) =>
          a.email === email && a.id !== exceptId && a.status !== "unverified"
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((a) => ({
        id: a.id,
        status: a.status,
        createdAt: copyDate(a.createdAt),
        closedAt: copyOptionalDate(a.closedAt),
      }))
  }

  claimedUsernames(names: readonly Username[], exceptId?: string): Set<string> {
    const claimed = new Set(
      this.s.applications
        .filter(
          (a) =>
            a.status === "provisioning" &&
            a.id !== exceptId &&
            a.assignedUsername !== null
        )
        .map((a) => a.assignedUsername as string)
    )
    return new Set(names.map((n) => n.value).filter((n) => claimed.has(n)))
  }

  list(closed: boolean): ReviewRow[] {
    return this.s.applications
      .filter((a) => {
        if (a.status === "unverified") return false
        const released =
          this.s.runs.find((r) => r.applicationId === a.id)?.releasedAt != null
        const open =
          isActive(a.status) || (a.status === "accepted" && !released)
        return closed ? !open : open
      })
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((a) => ({
        application: this.application(a.id) as Application,
        run: this.run(a.id),
        events: this.events(a.id),
        history: a.email === null ? [] : this.history(a.email, a.id),
      }))
  }

  /** Mirrors the unique indexes the Postgres tables carry. */
  conflict(next: Application): SaveResult | null {
    const others = this.s.applications.filter((a) => a.id !== next.id)
    const email = next.email?.value ?? null
    if (
      isActive(next.status) &&
      email !== null &&
      others.some((a) => a.email === email && isActive(a.status))
    ) {
      return "active_email_taken"
    }
    const username = next.assignment?.username.value ?? null
    if (
      next.status === "provisioning" &&
      username !== null &&
      others.some(
        (a) => a.status === "provisioning" && a.assignedUsername === username
      )
    ) {
      return "username_claimed"
    }
    if (
      next.status === "unverified" &&
      email !== null &&
      others.some((a) => a.email === email && a.status === "unverified")
    ) {
      throw new UnverifiedEmailTaken()
    }
    return null
  }

  save(t: Changed): SaveResult {
    const { previous, next } = t
    if (previous !== null && previous.id !== next.id) {
      throw new Error("previous and next are different applications")
    }
    const conflict = this.conflict(next)
    if (conflict) return conflict

    const s = next.snapshot
    const values = {
      status: s.status,
      version: s.version,
      email: s.email?.value ?? null,
      requestedStatus: s.requestedStatus,
      assignedStatus: s.assignment?.status ?? null,
      assignedCohort: s.assignment?.cohort.value ?? null,
      assignedUsername: s.assignment?.username.value ?? null,
      reviewedBy: s.reviewedBy,
      reviewedAt: s.reviewedAt,
      reviewNote: s.reviewNote,
      createdAt: s.createdAt,
      verifiedAt: s.verifiedAt,
      closedAt: s.closedAt,
      purgedAt: s.purgedAt,
    }

    if (previous === null) {
      if (this.row(s.id)) throw new Error(`application ${s.id} already exists`)
      // keycloak_id is written only by setKeycloakId.
      this.s.applications.push({ id: s.id, keycloakId: null, ...values })
    } else {
      const row = this.requireRow(s.id)
      if (row.version !== previous.version) throw new Error("version conflict")
      Object.assign(row, values)
    }

    this.saveProfile(s.id, s.profile)
    this.saveChangeRequest(s.id, previous?.changeRequest ?? null, s, t.at)
    if (
      (previous === null || previous.assignment === null) &&
      s.assignment !== null
    ) {
      for (const g of s.assignment.mailGroups) {
        this.s.mailGroups.push({
          applicationId: s.id,
          groupId: g.groupId,
          addedAt: null,
        })
      }
    }
    for (const e of t.events) {
      this.appendEvent(s.id, e.kind, e.changes, e.actor, e.at)
    }
    return "ok"
  }

  private saveProfile(id: string, next: ApplicantProfile | null) {
    const i = this.s.profiles.findIndex((p) => p.applicationId === id)
    if (next === null) {
      if (i >= 0) this.s.profiles.splice(i, 1)
      return
    }
    const fields = { ...next.fields }
    if (i < 0) this.s.profiles.push({ applicationId: id, fields })
    else if (!sameProfile(this.s.profiles[i].fields, fields))
      this.s.profiles[i] = { applicationId: id, fields }
  }

  private saveChangeRequest(
    id: string,
    previous: OpenChangeRequest | null,
    next: ApplicationSnapshot,
    at: Date
  ) {
    const replaced =
      previous !== null &&
      (next.changeRequest === null ||
        !sameTime(previous.requestedAt, next.changeRequest.requestedAt))
    if (replaced) {
      for (const c of this.s.changeRequests) {
        if (c.applicationId === id && c.endedAt === null)
          c.endedAt = copyDate(at)
      }
    }
    const added = next.changeRequest !== null && (previous === null || replaced)
    if (added && next.changeRequest) {
      const c = next.changeRequest
      this.s.changeRequests.push({
        id: this.s.nextChangeRequestId++,
        applicationId: id,
        note: c.note,
        requestedBy: c.requestedBy,
        requestedAt: copyDate(c.requestedAt),
        dueAt: copyDate(c.dueAt),
        endedAt: null,
      })
    }
  }

  appendEvent(
    applicationId: string,
    kind: EventKind,
    changes: Record<string, unknown> | null,
    actor: EventActor,
    at: Date
  ) {
    this.requireRow(applicationId)
    this.s.events.push({
      id: this.s.nextEventId++,
      applicationId,
      kind,
      actorKind: actor.kind,
      actorId: actor.kind === "admin" ? actor.id : null,
      // jsonb round trip: a Date becomes a string, an undefined key goes.
      changes: changes === null ? null : JSON.parse(JSON.stringify(changes)),
      at: copyDate(at),
    })
  }

  saveRun(run: ProvisioningRun) {
    const s = run.snapshot
    this.requireRow(s.applicationId)
    const row: RunRow = {
      applicationId: s.applicationId,
      attempts: s.attempts,
      nextAt: s.nextAt,
      error: s.error,
      blockedAt: s.blockedAt,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      releasedAt: s.releasedAt,
    }
    const i = this.s.runs.findIndex((r) => r.applicationId === s.applicationId)
    if (i < 0) this.s.runs.push(row)
    else this.s.runs[i] = row
    this.s.steps = this.s.steps.filter(
      (st) => st.applicationId !== s.applicationId
    )
    for (const c of s.completed) {
      this.s.steps.push({
        applicationId: s.applicationId,
        step: c.step,
        at: c.at,
      })
    }
  }

  deleteRun(applicationId: string) {
    this.s.runs = this.s.runs.filter((r) => r.applicationId !== applicationId)
    this.s.steps = this.s.steps.filter(
      (st) => st.applicationId !== applicationId
    )
  }

  claimDue(now: Date) {
    let best: { application: Application; run: ProvisioningRun } | null = null
    for (const row of this.s.applications) {
      if (row.status !== "provisioning" && row.status !== "accepted") continue
      const run = this.run(row.id)
      if (!run || !run.isDue(now)) continue
      if (!best || run.nextAt.getTime() < best.run.nextAt.getTime()) {
        best = { application: this.application(row.id) as Application, run }
      }
    }
    return best
  }

  putToken(
    applicationId: string,
    purpose: TokenPurpose,
    hash: TokenHash,
    now: Date
  ) {
    this.requireRow(applicationId)
    const others = this.s.tokens.filter(
      (t) => !(t.applicationId === applicationId && t.purpose === purpose)
    )
    if (others.some((t) => t.hash === hash.value)) {
      throw new Error("duplicate key value violates unique constraint on hash")
    }
    others.push({
      applicationId,
      purpose,
      hash: hash.value,
      createdAt: copyDate(now),
    })
    this.s.tokens = others
  }

  markMailGroupAdded(applicationId: string, groupId: string, at: Date) {
    const row = this.s.mailGroups.find(
      (g) => g.applicationId === applicationId && g.groupId === groupId
    )
    if (!row) {
      throw new Error(
        `application ${applicationId} has no mail group ${groupId}`
      )
    }
    row.addedAt = copyDate(at)
  }

  setKeycloakId(applicationId: string, id: string | null) {
    if (id !== null && !UUID.test(id)) {
      throw new Error(`invalid input syntax for type uuid: "${id}"`)
    }
    const row = this.requireRow(applicationId)
    if (id === null && row.status === "accepted") {
      throw new Error('violates check constraint "lab_applications_account"')
    }
    row.keycloakId = id
  }

  queueMail(applicationId: string | null, mail: ComposedMail) {
    if (applicationId !== null) this.requireRow(applicationId)
    this.s.outbox.push({
      mailId: crypto.randomUUID(),
      applicationId,
      mail: structuredClone(mail),
    })
  }

  reserveMail(
    recipient: Email,
    kind: AnonymousMailKind,
    now: Date,
    rate: MailRatePolicy
  ) {
    const key = recipient.rateKey()
    const after = (ms: number) => (r: MailLogRow) =>
      r.at.getTime() > now.getTime() - ms
    const mine = this.s.mailLog.filter((r) => r.rateKey === key)
    const result = rate.allows({
      recipientLastHour: mine.filter(after(HOUR)).length,
      recipientLastDay: mine.filter(after(DAY)).length,
      keyLastHour: this.s.mailLog.filter(after(HOUR)).length,
    })
    if (result === "ok") {
      this.s.mailLog.push({ rateKey: key, kind, at: copyDate(now) })
    }
    return result
  }

  claimAlert(key: string, notBefore: Date, now: Date): boolean {
    const row = this.s.alerts.find((a) => a.key === key)
    if (!row) {
      this.s.alerts.push({ key, sentAt: copyDate(now) })
      return true
    }
    if (row.sentAt.getTime() < notBefore.getTime()) {
      row.sentAt = copyDate(now)
      return true
    }
    return false
  }

  delete(applicationId: string) {
    const other = <T extends { applicationId: string | null }>(r: T) =>
      r.applicationId !== applicationId
    this.s.outbox = this.s.outbox.filter(other)
    this.s.applications = this.s.applications.filter(
      (a) => a.id !== applicationId
    )
    this.s.profiles = this.s.profiles.filter(other)
    this.s.changeRequests = this.s.changeRequests.filter(other)
    this.s.mailGroups = this.s.mailGroups.filter(other)
    this.s.events = this.s.events.filter(other)
    this.s.tokens = this.s.tokens.filter(other)
    this.deleteRun(applicationId)
  }

  purge(applicationId: string) {
    this.requireRow(applicationId)
    this.s.tokens = this.s.tokens.filter(
      (t) => t.applicationId !== applicationId
    )
    this.s.outbox = this.s.outbox.filter(
      (m) => m.applicationId !== applicationId
    )
    for (const c of this.s.changeRequests) {
      if (c.applicationId === applicationId) c.note = null
    }
    const run = this.s.runs.find((r) => r.applicationId === applicationId)
    if (run) run.error = null
    for (const e of this.s.events) {
      if (e.applicationId !== applicationId || e.changes === null) continue
      e.changes = Object.fromEntries(
        Object.keys(e.changes).map((k) => [k, null])
      )
    }
  }
}

/** One store per test; holds copies only, never the caller's objects. */
export class InMemoryApplicationStore implements ApplicationStore {
  private state: State = emptyState()
  private queue: Promise<unknown> = Promise.resolve()
  readonly reader: ApplicationReader

  private constructor(private readonly rate: MailRatePolicy) {
    const committed = () => new Tables(this.state)
    this.reader = {
      byToken: async (hash, purpose) => committed().byToken(hash, purpose),
      list: async ({ closed }) => committed().list(closed),
      passwordMail: async (id) => committed().passwordMail(id),
      claimedUsernames: async (names, exceptId) =>
        committed().claimedUsernames(names, exceptId),
      history: async (email, exceptId) =>
        committed().history(email.value, exceptId),
    }
  }

  static async create(
    opts: { rate?: MailRatePolicy } = {}
  ): Promise<InMemoryApplicationStore> {
    return new InMemoryApplicationStore(opts.rate ?? new MailRatePolicy())
  }

  private readonly inTransaction = new AsyncLocalStorage<true>()

  /** Runs one transaction at a time, in the order they were started. */
  transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    // A nested call would wait for its own parent; refuse it at once.
    if (this.inTransaction.getStore()) {
      return Promise.reject(new Error("nested transaction"))
    }
    const run = this.queue.then(() =>
      this.inTransaction.run(true, () => this.run(work))
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  /**
   * Like Postgres, an error from a store call aborts the transaction: every
   * later call throws until a savepoint around the failed call rolls back to
   * it. Work that swallows the error and returns still commits nothing; here
   * the transaction rejects, where Postgres would roll back on COMMIT.
   */
  private async run<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    const tables = new Tables(structuredClone(this.state))
    const tx = { open: true, aborted: false }
    const uow = this.unitOfWork(tables, tx)
    try {
      const result = await work(uow)
      if (tx.aborted) throw new Error(ABORTED)
      this.state = tables.s
      return result
    } finally {
      tx.open = false
    }
  }

  private unitOfWork(
    t: Tables,
    tx: { open: boolean; aborted: boolean }
  ): UnitOfWork {
    const usable = () => {
      if (!tx.open) throw new Error("the transaction has ended")
      if (tx.aborted) throw new Error(ABORTED)
    }
    const live =
      <A extends unknown[], R>(fn: (...args: A) => R) =>
      async (...args: A): Promise<Awaited<R>> => {
        usable()
        try {
          return await fn(...args)
        } catch (error) {
          tx.aborted = true
          throw error
        }
      }
    const rate = this.rate
    return {
      lock: live((id: string) => t.application(id)),
      lockByToken: live((hash: TokenHash, purpose: TokenPurpose) =>
        t.byToken(hash, purpose)
      ),
      lockByEmail: live(
        (email: Email, statuses: readonly ApplicationStatus[]) => {
          const row = t.s.applications
            .filter(
              (a) => a.email === email.value && statuses.includes(a.status)
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
          return row ? t.application(row.id) : null
        }
      ),
      lockRun: live((id: string) => t.run(id)),
      claimDue: live((now: Date) => t.claimDue(now)),
      passwordMail: live((id: string) => t.passwordMail(id)),
      save: live((c: Changed) => t.save(c)),
      saveRun: live((run: ProvisioningRun) => t.saveRun(run)),
      deleteRun: live((id: string) => t.deleteRun(id)),
      putToken: live(
        (id: string, purpose: TokenPurpose, hash: TokenHash, now: Date) =>
          t.putToken(id, purpose, hash, now)
      ),
      markMailGroupAdded: live((id: string, groupId: string, at: Date) =>
        t.markMailGroupAdded(id, groupId, at)
      ),
      setKeycloakId: live((id: string, kc: string | null) =>
        t.setKeycloakId(id, kc)
      ),
      appendEvent: live(
        (
          id: string,
          kind: EventKind,
          changes: Record<string, unknown> | null,
          actor: EventActor,
          at: Date
        ) => t.appendEvent(id, kind, changes, actor, at)
      ),
      queueMail: live((id: string | null, mail: ComposedMail) =>
        t.queueMail(id, mail)
      ),
      // Transactions run one at a time here, so there is nothing to lock.
      lockMailLimit: live(() => undefined),
      reserveMail: live(
        (recipient: Email, kind: AnonymousMailKind, now: Date) =>
          t.reserveMail(recipient, kind, now, rate)
      ),
      claimAlert: live((key: string, notBefore: Date, now: Date) =>
        t.claimAlert(key, notBefore, now)
      ),
      savepoint: async <R>(work: () => Promise<R>): Promise<R> => {
        usable()
        const saved = structuredClone(t.s)
        const rollBack = () => {
          Object.assign(t.s, saved)
          tx.aborted = false
        }
        let result: R
        try {
          result = await work()
        } catch (error) {
          rollBack()
          throw error
        }
        // The work swallowed a store error; RELEASE fails as in Postgres.
        if (tx.aborted) {
          rollBack()
          throw new Error(ABORTED)
        }
        return result
      },
      delete: live((id: string) => t.delete(id)),
      // `at` is unused: purging only clears data.
      purge: live((id: string) => t.purge(id)),
    }
  }

  /** Deletes a member as the FK does: their events lose the id. */
  forgetAdmin(adminId: string): void {
    for (const e of this.state.events) {
      if (e.actorKind === "admin" && e.actorId === adminId) e.actorId = null
    }
  }

  outbox(): readonly QueuedMail[] {
    return structuredClone(this.state.outbox)
  }

  events(applicationId: string): readonly EventRecord[] {
    return new Tables(this.state).events(applicationId)
  }

  /** Every change request's note, including ended ones, oldest first. */
  changeRequestNotes(applicationId: string): (string | null)[] {
    return this.state.changeRequests
      .filter((c) => c.applicationId === applicationId)
      .sort((a, b) => a.id - b.id)
      .map((c) => c.note)
  }
}

export class InMemorySettingsStore implements SettingsStore {
  private readonly users: Record<string, { name: string; email: string }>
  private notified: string[] = []
  private groups: string[] = []
  private site: {
    url: string | null
    updatedAt: Date | null
    updatedBy: string | null
  } = { url: null, updatedAt: null, updatedBy: null }

  constructor(users: Record<string, { name: string; email: string }>) {
    this.users = structuredClone(users)
  }

  private requireUser(userId: string) {
    const user = this.users[userId]
    if (!user) throw new Error(`user ${userId} does not exist`)
    return user
  }

  async notifiees() {
    return this.notified.map((userId) => ({
      userId,
      ...this.requireUser(userId),
    }))
  }

  // Settings rows keep no timestamps here; `now` is accepted and ignored.
  async setNotifiee(userId: string, notify: boolean, by: string) {
    this.requireUser(userId)
    this.requireUser(by)
    const has = this.notified.includes(userId)
    if (notify && !has) this.notified.push(userId)
    if (!notify && has)
      this.notified = this.notified.filter((id) => id !== userId)
  }

  async defaultMailGroups() {
    return [...this.groups]
  }

  async setMailGroup(groupId: string, enabled: boolean, by: string) {
    this.requireUser(by)
    const has = this.groups.includes(groupId)
    if (enabled && !has) this.groups.push(groupId)
    if (!enabled && has) this.groups = this.groups.filter((g) => g !== groupId)
  }

  async applySite() {
    return { ...this.site }
  }

  async setApplySite(url: string, by: string, now: Date) {
    this.requireUser(by)
    this.site = { url, updatedAt: now, updatedBy: by }
  }
}
