import type {
  ApplicationStatus,
  EventKind,
  LabStatus,
  RequestedStatus,
} from "./constants"
import { ApplicationLifecycle, type Command } from "./lifecycle"
import { ApplicationRefusal } from "./refusal"
import type { ApplicantProfile, Cohort, Email, Username } from "./values"

export type EventActor =
  { kind: "applicant" } | { kind: "admin"; id: string } | { kind: "system" }
export type AdminActor = Extract<EventActor, { kind: "admin" }>

export const APPLICANT: EventActor = Object.freeze({ kind: "applicant" })
export const SYSTEM: EventActor = Object.freeze({ kind: "system" })

export type DomainEvent = {
  kind: EventKind
  actor: EventActor
  changes: Record<string, unknown> | null
  at: Date
}

export type Assignment = {
  status: LabStatus
  cohort: Cohort
  username: Username
  mailGroups: readonly string[]
}

export type AssignedMailGroup = { groupId: string; addedAt: Date | null }

export type OpenChangeRequest = {
  note: string | null
  requestedBy: string | null
  requestedAt: Date
  dueAt: Date
}

export type ApplicationSnapshot = {
  id: string
  status: ApplicationStatus
  version: number
  email: Email | null
  requestedStatus: RequestedStatus
  profile: ApplicantProfile | null
  assignment: {
    status: LabStatus
    cohort: Cohort
    username: Username
    mailGroups: readonly AssignedMailGroup[]
  } | null
  reviewedBy: string | null
  reviewedAt: Date | null
  reviewNote: string | null
  keycloakId: string | null
  /** The change request still open, if any. */
  changeRequest: OpenChangeRequest | null
  createdAt: Date
  verifiedAt: Date | null
  closedAt: Date | null
  purgedAt: Date | null
}

export type SubmitInput = {
  id: string
  email: Email
  requestedStatus: RequestedStatus
  profile: ApplicantProfile
}

/** The complete new values; the service merges and parses them first. */
export type ProfileChange = {
  profile: ApplicantProfile
  requestedStatus: RequestedStatus
}

export type Changed = {
  kind: "changed"
  previous: Application | null
  next: Application
  events: DomainEvent[]
  at: Date
}
export type Transition = Changed | { kind: "unchanged"; current: Application }

const copyDate = (d: Date) => new Date(d.getTime())
const copyOptionalDate = (d: Date | null) => (d ? copyDate(d) : null)

// Value objects are frozen already, so copies share them.
function copy(s: ApplicationSnapshot): ApplicationSnapshot {
  return {
    ...s,
    assignment: s.assignment && {
      ...s.assignment,
      mailGroups: s.assignment.mailGroups.map((g) => ({
        groupId: g.groupId,
        addedAt: copyOptionalDate(g.addedAt),
      })),
    },
    reviewedAt: copyOptionalDate(s.reviewedAt),
    changeRequest: s.changeRequest && {
      ...s.changeRequest,
      requestedAt: copyDate(s.changeRequest.requestedAt),
      dueAt: copyDate(s.changeRequest.dueAt),
    },
    createdAt: copyDate(s.createdAt),
    verifiedAt: copyOptionalDate(s.verifiedAt),
    closedAt: copyOptionalDate(s.closedAt),
    purgedAt: copyOptionalDate(s.purgedAt),
  }
}

function freeze(s: ApplicationSnapshot): Readonly<ApplicationSnapshot> {
  if (s.assignment) {
    s.assignment.mailGroups.forEach((g) => Object.freeze(g))
    Object.freeze(s.assignment.mailGroups)
    Object.freeze(s.assignment)
  }
  if (s.changeRequest) Object.freeze(s.changeRequest)
  return Object.freeze(s)
}

function event(
  kind: EventKind,
  actor: EventActor,
  changes: Record<string, unknown> | null,
  now: Date
): DomainEvent {
  return { kind, actor, changes, at: copyDate(now) }
}

function sameGroups(a: readonly string[], b: readonly string[]): boolean {
  const x = new Set(a)
  const y = new Set(b)
  return x.size === y.size && [...x].every((g) => y.has(g))
}

type Unchanged = Extract<Transition, { kind: "unchanged" }>

export class Application {
  readonly #s: Readonly<ApplicationSnapshot>

  private constructor(snapshot: ApplicationSnapshot) {
    this.#s = freeze(copy(snapshot))
    Object.freeze(this)
  }

  static submit(input: SubmitInput, now: Date): Changed {
    const next = new Application({
      id: input.id,
      status: "unverified",
      version: 1,
      email: input.email,
      requestedStatus: input.requestedStatus,
      profile: input.profile,
      assignment: null,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      keycloakId: null,
      changeRequest: null,
      createdAt: now,
      verifiedAt: null,
      closedAt: null,
      purgedAt: null,
    })
    return {
      kind: "changed",
      previous: null,
      next,
      events: [event("submitted", APPLICANT, null, now)],
      at: copyDate(now),
    }
  }

  static restore(snapshot: ApplicationSnapshot): Application {
    return new Application(snapshot)
  }

  get snapshot(): ApplicationSnapshot {
    return copy(this.#s)
  }

  get id(): string {
    return this.#s.id
  }
  get status(): ApplicationStatus {
    return this.#s.status
  }
  get version(): number {
    return this.#s.version
  }
  get email(): Email | null {
    return this.#s.email
  }
  get requestedStatus(): RequestedStatus {
    return this.#s.requestedStatus
  }
  get profile(): ApplicantProfile | null {
    return this.#s.profile
  }
  get assignment(): ApplicationSnapshot["assignment"] {
    return this.snapshot.assignment
  }
  get reviewedBy(): string | null {
    return this.#s.reviewedBy
  }
  get reviewedAt(): Date | null {
    return copyOptionalDate(this.#s.reviewedAt)
  }
  get reviewNote(): string | null {
    return this.#s.reviewNote
  }
  get keycloakId(): string | null {
    return this.#s.keycloakId
  }
  get changeRequest(): OpenChangeRequest | null {
    return this.snapshot.changeRequest
  }
  get createdAt(): Date {
    return copyDate(this.#s.createdAt)
  }
  get verifiedAt(): Date | null {
    return copyOptionalDate(this.#s.verifiedAt)
  }
  get closedAt(): Date | null {
    return copyOptionalDate(this.#s.closedAt)
  }
  get purgedAt(): Date | null {
    return copyOptionalDate(this.#s.purgedAt)
  }

  confirm(now: Date): Transition {
    const to = this.target("confirm")
    if (!to) return this.unchanged()
    return this.change(
      { status: to, verifiedAt: now },
      [event("verified", APPLICANT, null, now)],
      now
    )
  }

  edit(
    change: ProfileChange,
    version: number,
    by: AdminActor,
    now: Date
  ): Transition {
    const to = this.target("edit")
    if (!to) return this.unchanged()
    this.checkVersion(version)
    const changes = this.diff(change)
    if (Object.keys(changes).length === 0) return this.unchanged()
    return this.change(
      {
        status: to,
        profile: change.profile,
        requestedStatus: change.requestedStatus,
      },
      [event("edited", by, changes, now)],
      now
    )
  }

  requestChanges(
    input: { note: string; dueAt: Date },
    version: number,
    by: AdminActor,
    now: Date
  ): Transition {
    const to = this.target("request_changes")
    if (!to) return this.unchanged()
    this.checkVersion(version)
    const note = input.note.trim()
    if (note === "") throw new ApplicationRefusal("invalid_input", "note")
    const open = this.#s.changeRequest
    if (
      this.#s.status === "changes_requested" &&
      open &&
      now.getTime() < open.dueAt.getTime()
    ) {
      throw new ApplicationRefusal("wrong_state")
    }
    return this.change(
      {
        status: to,
        changeRequest: {
          note,
          requestedBy: by.id,
          requestedAt: now,
          dueAt: input.dueAt,
        },
      },
      [
        event(
          "changes_requested",
          by,
          { due_at: input.dueAt.toISOString() },
          now
        ),
      ],
      now
    )
  }

  resubmit(change: ProfileChange, now: Date): Transition {
    const to = this.target("resubmit")
    if (!to) return this.unchanged()
    const open = this.#s.changeRequest
    if (!open) throw new Error(`application ${this.id} has no change request`)
    if (now.getTime() >= open.dueAt.getTime()) {
      throw new ApplicationRefusal("edit_window_closed")
    }
    return this.change(
      {
        status: to,
        profile: change.profile,
        requestedStatus: change.requestedStatus,
        changeRequest: null,
      },
      [event("resubmitted", APPLICANT, this.diff(change), now)],
      now
    )
  }

  withdraw(now: Date): Transition {
    const to = this.target("withdraw")
    if (!to) return this.unchanged()
    return this.change(
      { status: to, closedAt: now, changeRequest: null },
      [event("withdrawn", APPLICANT, null, now)],
      now
    )
  }

  accept(
    a: Assignment,
    version: number,
    by: AdminActor,
    now: Date
  ): Transition {
    const to = this.target("accept")
    if (!to) {
      if (this.sameAssignment(a)) return this.unchanged()
      throw new ApplicationRefusal("already_decided")
    }
    this.checkVersion(version)
    return this.change(
      {
        status: to,
        assignment: {
          status: a.status,
          cohort: a.cohort,
          username: a.username,
          mailGroups: a.mailGroups.map((groupId) => ({
            groupId,
            addedAt: null,
          })),
        },
        reviewedBy: by.id,
        reviewedAt: now,
      },
      [
        event(
          "accepted",
          by,
          {
            status: a.status,
            cohort: a.cohort.value,
            username: a.username.value,
            mail_groups: [...a.mailGroups],
          },
          now
        ),
      ],
      now
    )
  }

  /** No event: the service records `provision_retried` itself. */
  reassign(
    change: { username?: Username; cohort?: Cohort },
    now: Date
  ): Transition {
    const to = this.target("reassign")
    if (!to) return this.unchanged()
    const current = this.#s.assignment
    if (!current) throw new Error(`application ${this.id} has no assignment`)
    const username =
      change.username && change.username.value !== current.username.value
        ? change.username
        : null
    const cohort =
      change.cohort && change.cohort.value !== current.cohort.value
        ? change.cohort
        : null
    if (!username && !cohort) return this.unchanged()
    return this.change(
      {
        status: to,
        assignment: {
          ...current,
          username: username ?? current.username,
          cohort: cohort ?? current.cohort,
        },
      },
      [],
      now
    )
  }

  finish(now: Date): Transition {
    const to = this.target("finish")
    if (!to) return this.unchanged()
    if (this.#s.keycloakId === null) throw new ApplicationRefusal("wrong_state")
    return this.change(
      { status: to, closedAt: now },
      [event("provisioned", SYSTEM, null, now)],
      now
    )
  }

  reject(
    note: string | null,
    by: AdminActor | typeof SYSTEM,
    now: Date
  ): Transition {
    const to = this.target("reject")
    if (!to) return this.unchanged()
    return this.change(
      {
        status: to,
        closedAt: now,
        reviewNote: note,
        reviewedAt: now,
        reviewedBy: by.kind === "admin" ? by.id : null,
        changeRequest: null,
      },
      [event("rejected", by, null, now)],
      now
    )
  }

  closeHasAccount(now: Date): Transition {
    const to = this.target("close_has_account")
    if (!to) return this.unchanged()
    if (this.#s.keycloakId !== null) throw new ApplicationRefusal("wrong_state")
    return this.change(
      { status: to, closedAt: now },
      [event("rejected", SYSTEM, { reason: "has_account" }, now)],
      now
    )
  }

  purge(now: Date): Transition {
    const to = this.target("purge")
    if (!to) return this.unchanged()
    if (this.#s.purgedAt !== null) return this.unchanged()
    return this.change(
      {
        status: to,
        email: null,
        profile: null,
        reviewNote: null,
        changeRequest: null,
        purgedAt: now,
      },
      [event("purged", SYSTEM, null, now)],
      now
    )
  }

  /** The status the command moves to, or null when it has already happened. */
  private target(command: Command): ApplicationStatus | null {
    const outcome = ApplicationLifecycle.outcome(this.#s.status, command)
    if (outcome === "wrong_state") throw new ApplicationRefusal("wrong_state")
    return outcome === "already" ? null : outcome.to
  }

  private checkVersion(version: number): void {
    if (version !== this.#s.version) {
      throw new ApplicationRefusal("version_conflict")
    }
  }

  private diff(change: ProfileChange): Record<string, unknown> {
    const current = this.#s.profile
    if (!current) throw new Error(`application ${this.id} has no profile`)
    const changes: Record<string, unknown> = current.diff(change.profile)
    if (change.requestedStatus !== this.#s.requestedStatus) {
      changes.requested_status = {
        from: this.#s.requestedStatus,
        to: change.requestedStatus,
      }
    }
    return changes
  }

  private sameAssignment(a: Assignment): boolean {
    const current = this.#s.assignment
    return (
      current !== null &&
      current.status === a.status &&
      current.cohort.value === a.cohort.value &&
      current.username.value === a.username.value &&
      sameGroups(
        current.mailGroups.map((g) => g.groupId),
        a.mailGroups
      )
    )
  }

  private unchanged(): Unchanged {
    return { kind: "unchanged", current: this }
  }

  private change(
    patch: Partial<ApplicationSnapshot>,
    events: DomainEvent[],
    now: Date
  ): Changed {
    return {
      kind: "changed",
      previous: this,
      next: new Application({
        ...this.#s,
        ...patch,
        version: this.#s.version + 1,
      }),
      events,
      at: copyDate(now),
    }
  }
}
