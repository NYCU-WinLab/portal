import {
  Application,
  type AdminActor,
  type Changed,
  type OpenChangeRequest,
} from "../domain/application"
import {
  LAB_STATUSES,
  type LabStatus,
  type RequestedStatus,
} from "../domain/constants"
import {
  LabStatusPolicy,
  type MailRatePolicy,
  type RetentionPolicy,
} from "../domain/policies"
import { ProvisioningRun } from "../domain/provisioning-run"
import { ApplicationRefusal } from "../domain/refusal"
import {
  ApplicantProfile,
  Cohort,
  parseRequestedStatus,
  Username,
  type ProfileInput,
} from "../domain/values"
import {
  type ApplicationStore,
  type Clock,
  type EventRecord,
  type KeycloakDirectory,
  type MailGroups,
  type ProcessorAuthority,
  type ReservedNames,
  type ReviewRow,
  type SettingsStore,
  type TokenGenerator,
} from "../ports"
import type {
  ChangeRequestView,
  MutationResult,
  OkResult,
  ProfileView,
  ReviewItem,
} from "../views"
import type { MailComposer } from "./mail-composer"
import { passwordMailView, requestPasswordMail } from "./password-mail-request"

type Deps = {
  store: ApplicationStore
  directory: KeycloakDirectory
  authority: ProcessorAuthority
  settings: SettingsStore
  mailGroups: MailGroups
  /** Names that no username may take; checked when a username is typed in. */
  reserved: ReservedNames
  mail: MailComposer
  tokens: TokenGenerator
  retention: RetentionPolicy
  rate: MailRatePolicy
  clock: Clock
}

/** The complete new values are the current ones with these fields replaced. */
export type UpdatePatch = {
  requestedStatus?: string
  profile?: Partial<Record<keyof ProfileInput, string | null>>
}
export type AcceptInput = {
  status: string
  cohort: number
  username: string
  mailGroups: readonly string[]
}
export type RetryChange = { username?: string; cohort?: number }

const iso = (d: Date | null) => (d ? d.toISOString() : null)
const OPEN_STATUSES = ["pending", "changes_requested", "provisioning"]
const labStatusPolicy = new LabStatusPolicy()

/** The profile as it would be with the patch applied; bad keys are refused. */
function patchedInput(
  fields: Readonly<ProfileInput>,
  patch: UpdatePatch
): ProfileInput {
  const input: ProfileInput = { ...fields }
  for (const [key, value] of Object.entries(patch.profile ?? {})) {
    if (value === undefined) continue
    if (
      !Object.hasOwn(input, key) ||
      (typeof value !== "string" && value !== null)
    )
      throw new ApplicationRefusal("invalid_input")
    ;(input as Record<string, string | null>)[key] = value
  }
  return input
}

const admin = (id: string): AdminActor => ({ kind: "admin", id })

function changeRequestView(c: OpenChangeRequest, now: Date): ChangeRequestView {
  return {
    note: c.note,
    dueAt: c.dueAt.toISOString(),
    expired: now.getTime() >= c.dueAt.getTime(),
  }
}

function eventView(e: EventRecord): ReviewItem["events"][number] {
  return {
    id: e.id,
    kind: e.kind,
    actorKind: e.actor.kind,
    actorId: e.actor.kind === "admin" ? e.actor.id : null,
    changes: e.changes,
    at: e.at.toISOString(),
  }
}

/**
 * What a processor of account applications does. Anything that reads the
 * pool or Keycloak (settings, authority, mail groups, the directory) runs
 * before the transaction: a second pooled connection taken while the
 * transaction holds one can exhaust the pool. A refusal that must still send
 * mail (the missing cohort group) writes in its own transaction and throws
 * after it commits.
 */
export class ReviewService {
  constructor(private readonly d: Deps) {}

  async list(
    actorUserId: string,
    filter: { closed: boolean }
  ): Promise<ReviewItem[]> {
    const now = this.d.clock.now()
    const rows = await this.d.store.reader.list(filter)
    const isPortalAdmin = await this.d.authority.isPortalAdmin(actorUserId)
    const defaultGroups = await this.d.settings.defaultMailGroups()
    const groupIds = new Set(defaultGroups)
    for (const row of rows)
      for (const g of row.application.assignment?.mailGroups ?? [])
        groupIds.add(g.groupId)
    const addresses = groupIds.size
      ? await this.d.mailGroups.addresses([...groupIds])
      : new Map<string, string>()
    const candidates = new Map(
      rows.map((row) => [row.application.id, this.candidate(row)])
    )
    const named = [...candidates.values()].filter((u) => u !== null)
    let inKeycloak: Set<string> | null = new Set()
    if (named.length > 0) {
      try {
        inKeycloak = await this.d.directory.usernamesTaken(named)
      } catch (error) {
        // The page still lists, whatever went wrong (Keycloak down, setup
        // missing); it cannot say whether the name is free. Accept's check
        // stays strict. Only the error's type is logged.
        console.error("[applications] username check failed", {
          type: error instanceof Error ? error.name : typeof error,
        })
        inKeycloak = null
      }
    }
    // One read for every row. The set cannot say who claims a name, so a
    // row that is provisioning as its own candidate is not counted against
    // itself (assigned usernames are unique among provisioning rows).
    const claimed = inKeycloak
      ? named.length > 0
        ? await this.d.store.reader.claimedUsernames(named)
        : new Set<string>()
      : null
    const assignable = [...labStatusPolicy.assignable({ isPortalAdmin })]
    const items: ReviewItem[] = []
    for (const row of rows) {
      const name = candidates.get(row.application.id) ?? null
      let usernameTaken: boolean | null = null
      if (name && inKeycloak && claimed) {
        const own =
          row.application.status === "provisioning" &&
          row.application.assignment?.username.value === name.value
        usernameTaken =
          inKeycloak.has(name.value.toLowerCase()) ||
          (claimed.has(name.value) && !own)
      }
      items.push(
        await this.item(row, {
          now,
          assignable,
          defaultGroups,
          addresses,
          usernameTaken,
        })
      )
    }
    return items
  }

  async update(
    actorUserId: string,
    id: string,
    version: number,
    patch: UpdatePatch
  ): Promise<MutationResult> {
    const now = this.d.clock.now()
    const by = admin(actorUserId)
    // As in accept, the reserved names (Keycloak and the pool) are read
    // before the transaction, and only when the username moves.
    const before = await this.d.store.transaction((uow) => this.locked(uow, id))
    if (!before.profile) throw new ApplicationRefusal("wrong_state")
    const kept = before.profile.fields.username
    let asked: { name: string; taken: boolean } | null = null
    await Username.parse(patchedInput(before.profile.fields, patch).username, {
      has: async (name) => {
        const taken = name !== kept && (await this.d.reserved.has(name))
        asked = { name, taken }
        return taken
      },
    })

    return this.d.store.transaction(async (uow) => {
      const app = await this.locked(uow, id)
      if (!app.profile) throw new ApplicationRefusal("wrong_state")
      // The row changed its username since the check: ask again, not here.
      if (app.profile.fields.username !== kept)
        throw new ApplicationRefusal("version_conflict")
      const input = patchedInput(app.profile.fields, patch)
      const reserved: ReservedNames = {
        has: async (name) => {
          if (name === kept) return false
          if (asked && name === asked.name) return asked.taken
          throw new ApplicationRefusal("version_conflict")
        },
      }
      const change = {
        profile: await ApplicantProfile.parse(input, reserved),
        requestedStatus:
          patch.requestedStatus === undefined
            ? app.requestedStatus
            : parseRequestedStatus(patch.requestedStatus),
      }
      const t = app.edit(change, version, by, now)
      if (t.kind === "unchanged") return { ok: true, version: app.version }
      await this.save(uow, t)
      return { ok: true, version: t.next.version }
    })
  }

  async requestChanges(
    actorUserId: string,
    id: string,
    version: number,
    note: string
  ): Promise<MutationResult> {
    const now = this.d.clock.now()
    const by = admin(actorUserId)
    const site = await this.applySite()
    const dueAt = this.d.retention.changesDue(now)
    const text = note.trim()
    return this.d.store.transaction(async (uow) => {
      const app = await this.locked(uow, id)
      const t = app.requestChanges({ note: text, dueAt }, version, by, now)
      if (t.kind === "unchanged") return { ok: true, version: app.version }
      await this.save(uow, t)
      // A new link: the old one is replaced, as for every mail with a link.
      const access = this.d.tokens.generate()
      await uow.putToken(id, "access", access.hash, now)
      await uow.queueMail(
        id,
        this.d.mail.changesRequested(t.next, access.token, text, dueAt, site)
      )
      return { ok: true, version: t.next.version }
    })
  }

  async accept(
    actorUserId: string,
    id: string,
    version: number,
    input: AcceptInput
  ): Promise<MutationResult> {
    const now = this.d.clock.now()
    const by = admin(actorUserId)
    const status = this.labStatus(input.status)
    const cohort = Cohort.parse(input.cohort)
    const username = await Username.parse(input.username, this.d.reserved)
    const groups = [...new Set(input.mailGroups)]
    const isPortalAdmin = await this.d.authority.isPortalAdmin(actorUserId)
    labStatusPolicy.check(status, { isPortalAdmin })
    await this.checkMailGroups(actorUserId, groups)
    const assignment = { status, cohort, username, mailGroups: groups }

    // The checks below call Keycloak and the pool, so they run before the
    // writing transaction. They apply only to a first accept: a repeat has
    // already created the account, and the domain answers it.
    const current = await this.d.store.transaction((uow) =>
      this.locked(uow, id)
    )
    if (current.status === "pending") {
      const email = current.email
      if (!email) throw new Error(`application ${id} has no email`)
      const claimed = await this.d.store.reader.claimedUsernames([username], id)
      const taken = await this.d.directory.usernamesTaken([username])
      if (claimed.size > 0 || taken.size > 0)
        throw new ApplicationRefusal("username_unavailable")
      if (await this.d.directory.emailExists(email))
        throw new ApplicationRefusal("email_has_account")
      if (!(await this.d.directory.groupExists(cohort.groupPath))) {
        await this.alertCohortMissing(cohort, now)
        throw new ApplicationRefusal("cohort_group_missing")
      }
    }

    return this.d.store.transaction(async (uow) => {
      const app = await this.locked(uow, id)
      const t = app.accept(assignment, version, by, now)
      if (t.kind === "unchanged") return { ok: true, version: app.version }
      await this.save(uow, t)
      await uow.saveRun(ProvisioningRun.start(id, now))
      return { ok: true, version: t.next.version }
    })
  }

  async retryProvisioning(
    actorUserId: string,
    id: string,
    change: RetryChange = {}
  ): Promise<OkResult> {
    const now = this.d.clock.now()
    const by = admin(actorUserId)
    const username =
      change.username === undefined
        ? undefined
        : await Username.parse(change.username, this.d.reserved)
    const cohort =
      change.cohort === undefined ? undefined : Cohort.parse(change.cohort)

    // As in accept, a new value is checked before the transaction: Keycloak
    // and the pool are read here. A value equal to the current one needs no
    // check, and a state the retry refuses is left to the transaction.
    if (username || cohort) {
      const { current, run } = await this.d.store.transaction(async (uow) => ({
        current: await this.locked(uow, id),
        run: await uow.lockRun(id),
      }))
      const was = current.assignment
      const done = (step: string) =>
        run?.snapshot.completed.some((c) => c.step === step) ?? false
      if (current.status === "provisioning" && was) {
        // A step already done refuses the change itself, in the transaction.
        if (
          username &&
          username.value !== was.username.value &&
          !done("create_account")
        ) {
          const claimed = await this.d.store.reader.claimedUsernames(
            [username],
            id
          )
          const taken = await this.d.directory.usernamesTaken([username])
          if (claimed.size > 0 || taken.size > 0)
            throw new ApplicationRefusal("username_unavailable")
        }
        if (
          cohort &&
          cohort.value !== was.cohort.value &&
          !done("join_keycloak_groups")
        ) {
          if (!(await this.d.directory.groupExists(cohort.groupPath))) {
            await this.alertCohortMissing(cohort, now)
            throw new ApplicationRefusal("cohort_group_missing")
          }
        }
      }
    }

    return this.d.store.transaction(async (uow) => {
      const app = await this.locked(uow, id)
      if (app.status !== "provisioning")
        throw new ApplicationRefusal("wrong_state")
      const run = await uow.lockRun(id)
      if (!run) throw new Error(`provisioning application ${id} has no run`)
      const next = run.retry({ username, cohort }, now)
      const t = app.reassign({ username, cohort }, now)
      const changes: Record<string, unknown> = {}
      if (t.kind === "changed") {
        const before = app.assignment
        const after = t.next.assignment
        if (before && after) {
          if (before.username.value !== after.username.value)
            changes.username = {
              from: before.username.value,
              to: after.username.value,
            }
          if (before.cohort.value !== after.cohort.value)
            changes.cohort = {
              from: before.cohort.value,
              to: after.cohort.value,
            }
        }
        await this.save(uow, t)
      }
      await uow.appendEvent(
        id,
        "provision_retried",
        Object.keys(changes).length > 0 ? changes : null,
        by,
        now
      )
      await uow.saveRun(next)
      return { ok: true }
    })
  }

  async reject(
    actorUserId: string,
    id: string,
    note?: string
  ): Promise<OkResult> {
    const now = this.d.clock.now()
    const by = admin(actorUserId)
    const text = note?.trim() ? note.trim() : null
    return this.d.store.transaction(async (uow) => {
      const app = await this.locked(uow, id)
      const t = app.reject(text, by, now)
      // Already rejected: nothing to write and no second mail.
      if (t.kind === "unchanged") return { ok: true }
      // The open change request ends with the status (the domain clears it).
      await this.save(uow, t)
      await uow.queueMail(id, this.d.mail.rejected(t.next, text))
      return { ok: true }
    })
  }

  async resendPasswordMail(actorUserId: string, id: string): Promise<OkResult> {
    const now = this.d.clock.now()
    const by = admin(actorUserId)
    return this.d.store.transaction(async (uow) => {
      const app = await this.locked(uow, id)
      await requestPasswordMail(uow, this.d.rate, app, by, now)
      return { ok: true }
    })
  }

  /** Read once, outside any transaction; missing setup is an error. */
  private async applySite(): Promise<string> {
    const { url } = await this.d.settings.applySite()
    if (!url) throw new Error("申請網站網址尚未設定")
    return url
  }

  private async locked(
    uow: Parameters<Parameters<ApplicationStore["transaction"]>[0]>[0],
    id: string
  ): Promise<Application> {
    const app = await uow.lock(id)
    if (!app) throw new ApplicationRefusal("wrong_state")
    return app
  }

  private async save(
    uow: Parameters<Parameters<ApplicationStore["transaction"]>[0]>[0],
    t: Changed
  ): Promise<void> {
    const saved = await uow.save(t)
    if (saved === "username_claimed")
      throw new ApplicationRefusal("username_unavailable")
    if (saved !== "ok") throw new Error(`save failed: ${saved}`)
  }

  private labStatus(raw: string): LabStatus {
    const found = LAB_STATUSES.find((s) => s === raw)
    if (!found) throw new ApplicationRefusal("invalid_input", "status")
    return found
  }

  /** Every group is a default or one the actor manages, and one we can edit. */
  private async checkMailGroups(
    actorUserId: string,
    groups: readonly string[]
  ): Promise<void> {
    if (groups.length === 0) return
    const defaults = new Set(await this.d.settings.defaultMailGroups())
    for (const group of groups) {
      if (
        !defaults.has(group) &&
        !(await this.d.authority.managesGroup(actorUserId, group))
      )
        throw new ApplicationRefusal("mail_group_not_allowed")
      if (!(await this.d.mailGroups.isManageable(group)))
        throw new ApplicationRefusal("mail_group_not_allowed")
    }
  }

  /**
   * Its own transaction: the refusal that follows would roll the mail back.
   * One alert per cohort a day, so a processor trying again does not flood
   * the admins.
   */
  private async alertCohortMissing(cohort: Cohort, now: Date): Promise<void> {
    const to = await this.d.authority.portalAdminEmails()
    await this.d.store.transaction(async (uow) => {
      const first = await uow.claimAlert(
        `cohort:${cohort.value}`,
        this.d.retention.cohortAlertNotBefore(now),
        now
      )
      if (!first) return
      for (const address of to)
        await uow.queueMail(
          null,
          this.d.mail.cohortMissing(address, cohort.value, cohort.groupPath)
        )
    })
  }

  /**
   * The username a processor still has to decide on: not for a closed
   * application, and not once the account exists (the name is then its own).
   */
  private candidate(row: ReviewRow): Username | null {
    const app = row.application
    if (!OPEN_STATUSES.includes(app.status)) return null
    if (row.run?.snapshot.completed.some((c) => c.step === "create_account"))
      return null
    const value = app.assignment?.username.value ?? app.profile?.fields.username
    return value ? Username.restore(value) : null
  }

  private async item(
    row: ReviewRow,
    ctx: {
      now: Date
      assignable: LabStatus[]
      defaultGroups: string[]
      addresses: Map<string, string>
      usernameTaken: boolean | null
    }
  ): Promise<ReviewItem> {
    const app = row.application
    const run = row.run
    const assignment = app.assignment
    const profile = app.profile
    const fields: ProfileView | null = profile ? { ...profile.fields } : null
    const requested: RequestedStatus = app.requestedStatus
    const snap = run?.snapshot
    let passwordMail: ReviewItem["passwordMail"] = null
    if (app.status === "accepted" && run) {
      passwordMail = passwordMailView(
        await this.d.store.reader.passwordMail(app.id),
        run.releasedAt,
        this.d.retention,
        this.d.rate,
        ctx.now
      )
    }
    const cr = app.changeRequest
    return {
      id: app.id,
      status: app.status,
      version: app.version,
      email: app.email?.value ?? null,
      requestedStatus: requested,
      profile: fields,
      submittedAt: app.createdAt.toISOString(),
      verifiedAt: iso(app.verifiedAt),
      closedAt: iso(app.closedAt),
      reviewNote: app.reviewNote,
      defaults: {
        labStatus: labStatusPolicy.defaultFor(requested),
        cohort: Cohort.defaultFor(app.createdAt).value,
        mailGroups: ctx.defaultGroups,
      },
      assignableStatuses: ctx.assignable,
      assignment: assignment && {
        status: assignment.status,
        cohort: assignment.cohort.value,
        username: assignment.username.value,
        mailGroups: assignment.mailGroups.map((g) => ({
          groupId: g.groupId,
          address: ctx.addresses.get(g.groupId) ?? null,
          addedAt: iso(g.addedAt),
        })),
      },
      usernameTaken: ctx.usernameTaken,
      changeRequest: cr ? changeRequestView(cr, ctx.now) : null,
      provisioning: snap
        ? {
            attempts: snap.attempts,
            nextAt: snap.nextAt.toISOString(),
            error: snap.error,
            blockedAt: iso(snap.blockedAt),
            startedAt: snap.startedAt.toISOString(),
            finishedAt: iso(snap.finishedAt),
            releasedAt: iso(snap.releasedAt),
            steps: snap.completed.map((c) => ({
              name: c.step,
              completedAt: c.at.toISOString(),
            })),
          }
        : null,
      passwordMail,
      history: row.history.map((h) => ({
        id: h.id,
        status: h.status,
        createdAt: h.createdAt.toISOString(),
        closedAt: iso(h.closedAt),
      })),
      events: row.events.map(eventView),
    }
  }
}
