// The Postgres ApplicationStore and SettingsStore. Each method mirrors the
// method of the same name in lib/applications/testing/memory-store.ts; both
// pass lib/applications/contracts.
import { AsyncLocalStorage } from "node:async_hooks"
import { createHmac } from "node:crypto"

import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm"

import { scrubbed, scrubbedMethods } from "@/lib/actions/applications/db-errors"
import { queueMail } from "@/lib/actions/mail"
import {
  applicationReader,
  loadApplication,
  loadByEmail,
  loadByToken,
  loadPasswordMail,
  loadRun,
  type Tx,
} from "@/lib/actions/applications/store-reader"
import type {
  ApplicationSnapshot,
  Changed,
  EventActor,
  OpenChangeRequest,
} from "@/lib/applications/domain/application"
import {
  LINK_MAIL_KINDS,
  type AnonymousMailKind,
  type ApplicationStatus,
  type EventKind,
  type TokenPurpose,
} from "@/lib/applications/domain/constants"
import type { MailRatePolicy } from "@/lib/applications/domain/policies"
import type { ProvisioningRun } from "@/lib/applications/domain/provisioning-run"
import type {
  ApplicantProfile,
  Email,
  TokenHash,
} from "@/lib/applications/domain/values"
import {
  UnverifiedEmailTaken,
  type ApplicationReader,
  type ApplicationStore,
  type ComposedMail,
  type SaveResult,
  type SettingsStore,
  type UnitOfWork,
} from "@/lib/applications/ports"
import type { Db } from "@/lib/db"
import {
  applicationAlerts,
  applicationDefaultMailGroups,
  applicationMailLog,
  applicationNotifiees,
  applicationSettings,
  labApplicationChangeRequests,
  labApplicationEvents,
  labApplicationMailGroups,
  labApplicationMails,
  labApplicationProfiles,
  labApplicationProvisioning,
  labApplicationProvisionSteps,
  labApplications,
  labApplicationTokens,
  mailOutbox,
  user,
} from "@/lib/db/schema"

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * The constraint a unique violation (23505) broke, or null for any other
 * error. Drizzle wraps the pg error, so it is read from `cause`.
 */
export function uniqueViolation(error: unknown): string | null {
  const cause = (error as { cause?: { code?: unknown; constraint?: unknown } })
    ?.cause
  if (cause?.code !== "23505") return null
  return typeof cause.constraint === "string" ? cause.constraint : null
}

const sameTime = (a: Date, b: Date) => a.getTime() === b.getTime()

function sameProfile(a: ApplicantProfile | null, b: ApplicantProfile) {
  if (a === null) return false
  const x = a.fields
  const y = b.fields
  return (Object.keys(y) as (keyof typeof y)[]).every((k) => x[k] === y[k])
}

// A jsonb round trip: a Date becomes a string, an undefined key goes.
const asJson = (changes: Record<string, unknown> | null) =>
  changes === null
    ? null
    : (JSON.parse(JSON.stringify(changes)) as Record<string, unknown>)

class DrizzleUnitOfWork implements UnitOfWork {
  private open = true
  private savepoints = 0

  constructor(
    private readonly tx: Tx,
    private readonly opts: {
      rate: MailRatePolicy
      hashSecret: () => string | Buffer
    }
  ) {}

  /** Called once the transaction has committed or rolled back. */
  end() {
    this.open = false
  }

  private usable() {
    if (!this.open) throw new Error("the transaction has ended")
  }

  /**
   * Runs work inside a uniquely named savepoint. Drizzle's nested
   * transactions reuse one name per depth, and a ROLLBACK TO keeps the
   * savepoint, so an outer rollback could stop at an inner one.
   */
  private async inSavepoint<T>(work: () => Promise<T>): Promise<T> {
    const name = sql.raw(`application_sp_${++this.savepoints}`)
    await this.tx.execute(sql`savepoint ${name}`)
    let result: T
    try {
      result = await work()
    } catch (error) {
      await this.tx.execute(sql`rollback to savepoint ${name}`)
      await this.tx.execute(sql`release savepoint ${name}`)
      throw error
    }
    try {
      // Fails when the work swallowed a store error, as the memory store does.
      await this.tx.execute(sql`release savepoint ${name}`)
    } catch (error) {
      await this.tx.execute(sql`rollback to savepoint ${name}`)
      await this.tx.execute(sql`release savepoint ${name}`)
      throw error
    }
    return result
  }

  async savepoint<T>(work: () => Promise<T>): Promise<T> {
    this.usable()
    return this.inSavepoint(work)
  }

  async lock(id: string) {
    this.usable()
    return loadApplication(this.tx, id, true)
  }

  async lockByToken(hash: TokenHash, purpose: TokenPurpose) {
    this.usable()
    return loadByToken(this.tx, hash, purpose, true)
  }

  async lockByEmail(email: Email, statuses: readonly ApplicationStatus[]) {
    this.usable()
    return loadByEmail(this.tx, email, statuses, true)
  }

  async lockRun(applicationId: string) {
    this.usable()
    return loadRun(this.tx, applicationId, true)
  }

  async claimDue(now: Date) {
    this.usable()
    // isDue: not blocked, not released, nextAt <= now.
    const [due] = await this.tx
      .select({ id: labApplicationProvisioning.applicationId })
      .from(labApplicationProvisioning)
      .innerJoin(
        labApplications,
        eq(labApplications.id, labApplicationProvisioning.applicationId)
      )
      .where(
        and(
          inArray(labApplications.status, ["provisioning", "accepted"]),
          isNull(labApplicationProvisioning.blockedAt),
          isNull(labApplicationProvisioning.releasedAt),
          lte(labApplicationProvisioning.nextAt, now)
        )
      )
      .orderBy(asc(labApplicationProvisioning.nextAt))
      .limit(1)
      .for("update", { skipLocked: true })
    if (!due) return null
    const application = await loadApplication(this.tx, due.id, false)
    const run = await loadRun(this.tx, due.id, false)
    if (!application || !run) throw new Error(`run ${due.id} vanished`)
    return { application, run }
  }

  async passwordMail(applicationId: string) {
    this.usable()
    return loadPasswordMail(this.tx, applicationId)
  }

  async save(t: Changed): Promise<SaveResult> {
    this.usable()
    try {
      await this.inSavepoint(() => this.write(t))
      return "ok"
    } catch (error) {
      switch (uniqueViolation(error)) {
        case "lab_applications_active_email":
          return "active_email_taken"
        case "lab_applications_claimed_username":
          return "username_claimed"
        case "lab_applications_unverified_email":
          throw new UnverifiedEmailTaken()
        default:
          throw error
      }
    }
  }

  private async write(t: Changed) {
    const { previous, next } = t
    if (previous !== null && previous.id !== next.id) {
      throw new Error("previous and next are different applications")
    }
    const s = next.snapshot
    // keycloak_id is written only by setKeycloakId.
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
      await this.tx.insert(labApplications).values({ id: s.id, ...values })
    } else {
      const updated = await this.tx
        .update(labApplications)
        .set(values)
        .where(
          and(
            eq(labApplications.id, s.id),
            eq(labApplications.version, previous.version)
          )
        )
        .returning({ id: labApplications.id })
      if (updated.length === 0) throw new Error("version conflict")
    }

    await this.writeProfile(s.id, previous?.profile ?? null, s.profile, t.at)
    await this.writeChangeRequest(
      s.id,
      previous?.changeRequest ?? null,
      s,
      t.at
    )
    if (
      (previous === null || previous.assignment === null) &&
      s.assignment !== null &&
      s.assignment.mailGroups.length > 0
    ) {
      await this.tx.insert(labApplicationMailGroups).values(
        s.assignment.mailGroups.map((g) => ({
          applicationId: s.id,
          groupId: g.groupId,
          addedAt: null,
        }))
      )
    }
    for (const e of t.events) {
      await this.insertEvent(s.id, e.kind, e.changes, e.actor, e.at)
    }
  }

  private async writeProfile(
    id: string,
    previous: ApplicantProfile | null,
    next: ApplicantProfile | null,
    at: Date
  ) {
    if (next === null) {
      await this.tx
        .delete(labApplicationProfiles)
        .where(eq(labApplicationProfiles.applicationId, id))
      return
    }
    if (sameProfile(previous, next)) return
    const row = { ...next.fields, updatedAt: at }
    await this.tx
      .insert(labApplicationProfiles)
      .values({ applicationId: id, ...row })
      .onConflictDoUpdate({
        target: labApplicationProfiles.applicationId,
        set: row,
      })
  }

  private async writeChangeRequest(
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
      await this.tx
        .update(labApplicationChangeRequests)
        .set({ closedAt: at })
        .where(
          and(
            eq(labApplicationChangeRequests.applicationId, id),
            isNull(labApplicationChangeRequests.closedAt)
          )
        )
    }
    const c = next.changeRequest
    if (c !== null && (previous === null || replaced)) {
      await this.tx.insert(labApplicationChangeRequests).values({
        applicationId: id,
        note: c.note,
        requestedBy: c.requestedBy,
        requestedAt: c.requestedAt,
        dueAt: c.dueAt,
      })
    }
  }

  private async insertEvent(
    applicationId: string,
    kind: EventKind,
    changes: Record<string, unknown> | null,
    actor: EventActor,
    at: Date
  ) {
    await this.tx.insert(labApplicationEvents).values({
      applicationId,
      kind,
      actorKind: actor.kind,
      actorId: actor.kind === "admin" ? actor.id : null,
      changes: asJson(changes),
      createdAt: at,
    })
  }

  async saveRun(run: ProvisioningRun) {
    this.usable()
    const s = run.snapshot
    const row = {
      attempts: s.attempts,
      nextAt: s.nextAt,
      error: s.error,
      blockedAt: s.blockedAt,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      releasedAt: s.releasedAt,
    }
    await this.tx
      .insert(labApplicationProvisioning)
      .values({ applicationId: s.applicationId, ...row })
      .onConflictDoUpdate({
        target: labApplicationProvisioning.applicationId,
        set: row,
      })
    await this.tx
      .delete(labApplicationProvisionSteps)
      .where(eq(labApplicationProvisionSteps.applicationId, s.applicationId))
    if (s.completed.length > 0) {
      await this.tx.insert(labApplicationProvisionSteps).values(
        s.completed.map((c) => ({
          applicationId: s.applicationId,
          step: c.step,
          completedAt: c.at,
        }))
      )
    }
  }

  async deleteRun(applicationId: string) {
    this.usable()
    // Steps go with the run (on delete cascade).
    await this.tx
      .delete(labApplicationProvisioning)
      .where(eq(labApplicationProvisioning.applicationId, applicationId))
  }

  async putToken(
    applicationId: string,
    purpose: TokenPurpose,
    hash: TokenHash,
    now: Date
  ) {
    this.usable()
    await this.tx
      .delete(labApplicationTokens)
      .where(
        and(
          eq(labApplicationTokens.applicationId, applicationId),
          eq(labApplicationTokens.purpose, purpose)
        )
      )
    await this.tx.insert(labApplicationTokens).values({
      applicationId,
      purpose,
      tokenHash: hash.value,
      createdAt: now,
    })
  }

  async markMailGroupAdded(applicationId: string, groupId: string, at: Date) {
    this.usable()
    const updated = await this.tx
      .update(labApplicationMailGroups)
      .set({ addedAt: at })
      .where(
        and(
          eq(labApplicationMailGroups.applicationId, applicationId),
          eq(labApplicationMailGroups.groupId, groupId)
        )
      )
      .returning({ groupId: labApplicationMailGroups.groupId })
    if (updated.length === 0) {
      throw new Error(
        `application ${applicationId} has no mail group ${groupId}`
      )
    }
  }

  async setKeycloakId(applicationId: string, id: string | null) {
    this.usable()
    const updated = await this.tx
      .update(labApplications)
      .set({ keycloakId: id })
      .where(eq(labApplications.id, applicationId))
      .returning({ id: labApplications.id })
    if (updated.length === 0) {
      throw new Error(`application ${applicationId} does not exist`)
    }
  }

  async appendEvent(
    applicationId: string,
    kind: EventKind,
    changes: Record<string, unknown> | null,
    actor: EventActor,
    at: Date
  ) {
    this.usable()
    await this.insertEvent(applicationId, kind, changes, actor, at)
  }

  async queueMail(applicationId: string | null, mail: ComposedMail) {
    this.usable()
    const mailId = await queueMail(this.tx, {
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      redactAfterSend: (LINK_MAIL_KINDS as readonly string[]).includes(
        mail.kind
      ),
    })
    if (mailId === null) throw new Error("mail has no recipient")
    if (applicationId !== null) {
      await this.tx
        .insert(labApplicationMails)
        .values({ mailId, applicationId, kind: mail.kind })
    }
  }

  async lockMailLimit() {
    this.usable()
    // Re-entrant: a second call in the same transaction returns at once.
    await this.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('lab_applications'), hashtext('mail_limit'))`
    )
  }

  async reserveMail(recipient: Email, kind: AnonymousMailKind, now: Date) {
    this.usable()
    const secret = this.opts.hashSecret()
    if (secret.length === 0) throw new Error("the mail rate key is empty")
    // One reservation at a time, so concurrent counts cannot both pass.
    await this.lockMailLimit()
    const hash = createHmac("sha256", secret)
      .update(recipient.rateKey())
      .digest("hex")
    const since = (ms: number) => new Date(now.getTime() - ms)
    const [counts] = await this.tx
      .select({
        recipientLastHour: sql<number>`(count(*) filter (where ${applicationMailLog.recipientHash} = ${hash} and ${applicationMailLog.createdAt} > ${since(HOUR)}))::int`,
        recipientLastDay: sql<number>`(count(*) filter (where ${applicationMailLog.recipientHash} = ${hash}))::int`,
        keyLastHour: sql<number>`(count(*) filter (where ${applicationMailLog.createdAt} > ${since(HOUR)}))::int`,
      })
      .from(applicationMailLog)
      .where(gt(applicationMailLog.createdAt, since(DAY)))
    const result = this.opts.rate.allows(counts)
    if (result === "ok") {
      await this.tx
        .insert(applicationMailLog)
        .values({ recipientHash: hash, kind, createdAt: now })
    }
    return result
  }

  async claimAlert(key: string, notBefore: Date, now: Date) {
    this.usable()
    const claimed = await this.tx
      .insert(applicationAlerts)
      .values({ key, sentAt: now })
      .onConflictDoUpdate({
        target: applicationAlerts.key,
        set: { sentAt: now },
        setWhere: sql`${applicationAlerts.sentAt} < ${notBefore}`,
      })
      .returning({ key: applicationAlerts.key })
    return claimed.length > 0
  }

  /** Deletes the outbox mail queued for the application. */
  private async deleteQueuedMail(applicationId: string) {
    await this.tx
      .delete(mailOutbox)
      .where(
        inArray(
          mailOutbox.id,
          this.tx
            .select({ id: labApplicationMails.mailId })
            .from(labApplicationMails)
            .where(eq(labApplicationMails.applicationId, applicationId))
        )
      )
  }

  async delete(applicationId: string) {
    this.usable()
    await this.deleteQueuedMail(applicationId)
    // Every child table cascades from lab_applications.
    await this.tx
      .delete(labApplications)
      .where(eq(labApplications.id, applicationId))
  }

  // `at` is unused: purging only clears data.
  async purge(applicationId: string) {
    this.usable()
    const [exists] = await this.tx
      .select({ id: labApplications.id })
      .from(labApplications)
      .where(eq(labApplications.id, applicationId))
    if (!exists) throw new Error(`application ${applicationId} does not exist`)
    await this.tx
      .delete(labApplicationTokens)
      .where(eq(labApplicationTokens.applicationId, applicationId))
    await this.deleteQueuedMail(applicationId)
    // save(purge) removed the profile already; this keeps purge whole alone.
    await this.tx
      .delete(labApplicationProfiles)
      .where(eq(labApplicationProfiles.applicationId, applicationId))
    await this.tx
      .update(labApplicationChangeRequests)
      .set({ note: null })
      .where(eq(labApplicationChangeRequests.applicationId, applicationId))
    await this.tx
      .update(labApplicationProvisioning)
      .set({ error: null })
      .where(eq(labApplicationProvisioning.applicationId, applicationId))
    // Keep each key, null every value.
    await this.tx
      .update(labApplicationEvents)
      .set({
        changes: sql`(select coalesce(jsonb_object_agg(k, null::jsonb), '{}'::jsonb) from jsonb_object_keys(${labApplicationEvents.changes}) as k)`,
      })
      .where(
        and(
          eq(labApplicationEvents.applicationId, applicationId),
          sql`${labApplicationEvents.changes} is not null`
        )
      )
  }
}

export class DrizzleApplicationStore implements ApplicationStore {
  readonly reader: ApplicationReader
  private readonly inTransaction = new AsyncLocalStorage<true>()

  constructor(
    private readonly db: Db,
    private readonly opts: {
      rate: MailRatePolicy
      /** Read lazily: only reserveMail needs it. */
      hashSecret: () => string | Buffer
    }
  ) {
    this.reader = scrubbedMethods(applicationReader(db))
  }

  /**
   * Read committed. Transactions do not nest. A query error leaves without
   * its parameters; the unit of work maps 23505 before that.
   */
  async transaction<T>(work: (uow: UnitOfWork) => Promise<T>): Promise<T> {
    // A nested call would hold a second connection while the first waits.
    if (this.inTransaction.getStore()) throw new Error("nested transaction")
    return this.inTransaction.run(true, () =>
      scrubbed(() =>
        this.db.transaction(async (tx) => {
          const uow = new DrizzleUnitOfWork(tx, this.opts)
          try {
            return await work(uow)
          } finally {
            uow.end()
          }
        })
      )
    )
  }
}

export class DrizzleSettingsStore implements SettingsStore {
  constructor(private readonly db: Db) {}

  async notifiees() {
    return this.db
      .select({ userId: user.id, name: user.name, email: user.email })
      .from(applicationNotifiees)
      .innerJoin(user, eq(user.id, applicationNotifiees.userId))
      .orderBy(asc(applicationNotifiees.createdAt), asc(user.id))
  }

  async setNotifiee(userId: string, notify: boolean, by: string, now: Date) {
    if (notify) {
      await this.db
        .insert(applicationNotifiees)
        .values({ userId, createdBy: by, createdAt: now })
        .onConflictDoNothing()
    } else {
      await this.db
        .delete(applicationNotifiees)
        .where(eq(applicationNotifiees.userId, userId))
    }
  }

  async defaultMailGroups() {
    const rows = await this.db
      .select({ groupId: applicationDefaultMailGroups.groupId })
      .from(applicationDefaultMailGroups)
      .orderBy(
        asc(applicationDefaultMailGroups.createdAt),
        asc(applicationDefaultMailGroups.groupId)
      )
    return rows.map((r) => r.groupId)
  }

  async setMailGroup(groupId: string, enabled: boolean, by: string, now: Date) {
    if (enabled) {
      await this.db
        .insert(applicationDefaultMailGroups)
        .values({ groupId, createdBy: by, createdAt: now })
        .onConflictDoNothing()
    } else {
      await this.db
        .delete(applicationDefaultMailGroups)
        .where(eq(applicationDefaultMailGroups.groupId, groupId))
    }
  }

  async applySite() {
    const [row] = await this.db
      .select({
        url: applicationSettings.applySiteUrl,
        updatedAt: applicationSettings.updatedAt,
        updatedBy: applicationSettings.updatedBy,
      })
      .from(applicationSettings)
      .limit(1)
    return row ?? { url: null, updatedAt: null, updatedBy: null }
  }

  async setApplySite(url: string, by: string, now: Date) {
    await this.db
      .insert(applicationSettings)
      .values({ id: true, applySiteUrl: url, updatedBy: by, updatedAt: now })
      .onConflictDoUpdate({
        target: applicationSettings.id,
        set: { applySiteUrl: url, updatedBy: by, updatedAt: now },
      })
  }
}
