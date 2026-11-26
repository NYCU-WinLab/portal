// Reads for the Postgres application store. Each function takes the
// connection to read on: the pool for the reader, the transaction for a unit
// of work (which passes `lock` to take row locks). Mirrors the reads of
// lib/applications/testing/memory-store.ts.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm"

import {
  Application,
  type ApplicationSnapshot,
  type RecordedActor,
  type OpenChangeRequest,
} from "@/lib/applications/domain/application"
import {
  ACTIVE_STATUSES,
  PASSWORD_MAIL_EVENT_KINDS,
  STEP_NAMES,
  type ApplicationStatus,
  type EventKind,
  type LabStatus,
  type RequestedStatus,
  type StepName,
  type TokenPurpose,
} from "@/lib/applications/domain/constants"
import {
  derivePasswordMail,
  type PasswordMailEvent,
  type PasswordMailState,
} from "@/lib/applications/domain/password-mail"
import { ProvisioningRun } from "@/lib/applications/domain/provisioning-run"
import {
  ApplicantProfile,
  Cohort,
  Email,
  Username,
  type TokenHash,
} from "@/lib/applications/domain/values"
import type {
  ApplicationReader,
  EventRecord,
  HistoryRow,
  ReviewRow,
  TokenLookup,
} from "@/lib/applications/ports"
import type { Db } from "@/lib/db"
import {
  labApplicationChangeRequests,
  labApplicationEvents,
  labApplicationMailGroups,
  labApplicationProfiles,
  labApplicationProvisioning,
  labApplicationProvisionSteps,
  labApplications,
  labApplicationTokens,
} from "@/lib/db/schema"

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]
/** Where a read runs: the pool, or the unit of work's transaction. */
export type Q = Db | Tx

type ApplicationRow = typeof labApplications.$inferSelect

const ACTIVE: readonly string[] = ACTIVE_STATUSES

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

// Code-unit order, as the memory store sorts; independent of the collation.
const byCodeUnit = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)

/** Builds each application from its row and its child tables. */
async function hydrate(q: Q, rows: ApplicationRow[]): Promise<Application[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  // One query at a time: inside a transaction q is a single client, and pg
  // does not allow overlapping queries on one client.
  const profiles = await q
    .select()
    .from(labApplicationProfiles)
    .where(inArray(labApplicationProfiles.applicationId, ids))
  const changeRequests = await q
    .select()
    .from(labApplicationChangeRequests)
    .where(
      and(
        inArray(labApplicationChangeRequests.applicationId, ids),
        isNull(labApplicationChangeRequests.closedAt)
      )
    )
  const mailGroups = await q
    .select()
    .from(labApplicationMailGroups)
    .where(inArray(labApplicationMailGroups.applicationId, ids))
  const profileOf = new Map(profiles.map((p) => [p.applicationId, p]))
  const openOf = new Map(changeRequests.map((c) => [c.applicationId, c]))
  const groupsOf = groupBy(mailGroups, (g) => g.applicationId)

  return rows.map((row) => {
    const p = profileOf.get(row.id)
    const open = openOf.get(row.id)
    const changeRequest: OpenChangeRequest | null = open
      ? {
          note: open.note,
          requestedBy: open.requestedBy,
          requestedAt: open.requestedAt,
          dueAt: open.dueAt,
        }
      : null
    const assignment =
      row.assignedStatus !== null &&
      row.assignedCohort !== null &&
      row.assignedUsername !== null
        ? {
            status: row.assignedStatus as LabStatus,
            cohort: Cohort.restore(row.assignedCohort),
            username: Username.restore(row.assignedUsername),
            mailGroups: (groupsOf.get(row.id) ?? [])
              .sort((x, y) => byCodeUnit(x.groupId, y.groupId))
              .map((g) => ({ groupId: g.groupId, addedAt: g.addedAt })),
          }
        : null
    const snapshot: ApplicationSnapshot = {
      id: row.id,
      status: row.status as ApplicationStatus,
      version: row.version,
      email: row.email === null ? null : Email.restore(row.email),
      requestedStatus: row.requestedStatus as RequestedStatus,
      profile: p
        ? ApplicantProfile.restore({
            username: p.username,
            chineseName: p.chineseName,
            firstName: p.firstName,
            lastName: p.lastName,
            studentId: p.studentId,
            birthday: p.birthday,
            phone: p.phone,
            nycuEmail: p.nycuEmail,
            department: p.department,
            lineId: p.lineId,
          })
        : null,
      assignment,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
      keycloakId: row.keycloakId,
      changeRequest,
      createdAt: row.createdAt,
      verifiedAt: row.verifiedAt,
      closedAt: row.closedAt,
      purgedAt: row.purgedAt,
    }
    return Application.restore(snapshot)
  })
}

/** The application, or null; `lock` takes its row lock first. */
export async function loadApplication(
  q: Q,
  id: string,
  lock: boolean
): Promise<Application | null> {
  const query = q
    .select()
    .from(labApplications)
    .where(eq(labApplications.id, id))
  const rows = lock ? await query.for("update") : await query
  const [application] = await hydrate(q, rows)
  return application ?? null
}

/** Newest application with this email in one of the statuses. */
export async function loadByEmail(
  q: Q,
  email: Email,
  statuses: readonly ApplicationStatus[],
  lock: boolean
): Promise<Application | null> {
  if (statuses.length === 0) return null
  const query = q
    .select()
    .from(labApplications)
    .where(
      and(
        eq(labApplications.email, email.value),
        inArray(labApplications.status, [...statuses])
      )
    )
    .orderBy(desc(labApplications.createdAt))
    .limit(1)
  const rows = lock ? await query.for("update") : await query
  const [application] = await hydrate(q, rows)
  return application ?? null
}

/** Runs and their completed steps, by application id. */
export async function loadRuns(
  q: Q,
  ids: string[],
  lock: boolean
): Promise<Map<string, ProvisioningRun>> {
  if (ids.length === 0) return new Map()
  const query = q
    .select()
    .from(labApplicationProvisioning)
    .where(inArray(labApplicationProvisioning.applicationId, ids))
  const runs = lock ? await query.for("update") : await query
  if (runs.length === 0) return new Map()
  const steps = await q
    .select()
    .from(labApplicationProvisionSteps)
    .where(
      inArray(
        labApplicationProvisionSteps.applicationId,
        runs.map((r) => r.applicationId)
      )
    )
  const stepsOf = groupBy(steps, (s) => s.applicationId)
  const order = (step: string) => STEP_NAMES.indexOf(step as StepName)
  return new Map(
    runs.map((r) => [
      r.applicationId,
      ProvisioningRun.restore({
        applicationId: r.applicationId,
        attempts: r.attempts,
        nextAt: r.nextAt,
        error: r.error,
        blockedAt: r.blockedAt,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        releasedAt: r.releasedAt,
        // Steps complete in STEP_NAMES order; the table keeps no other order.
        completed: (stepsOf.get(r.applicationId) ?? [])
          .sort(
            (x, y) =>
              x.completedAt.getTime() - y.completedAt.getTime() ||
              order(x.step) - order(y.step)
          )
          .map((s) => ({ step: s.step as StepName, at: s.completedAt })),
      }),
    ])
  )
}

export async function loadRun(
  q: Q,
  applicationId: string,
  lock: boolean
): Promise<ProvisioningRun | null> {
  return (await loadRuns(q, [applicationId], lock)).get(applicationId) ?? null
}

/** The token's application; `lock` locks the token and application rows. */
export async function loadByToken(
  q: Q,
  hash: TokenHash,
  purpose: TokenPurpose,
  lock: boolean
): Promise<TokenLookup | null> {
  const query = q
    .select({
      application: labApplications,
      tokenCreatedAt: labApplicationTokens.createdAt,
    })
    .from(labApplicationTokens)
    .innerJoin(
      labApplications,
      eq(labApplications.id, labApplicationTokens.applicationId)
    )
    .where(
      and(
        eq(labApplicationTokens.tokenHash, hash.value),
        eq(labApplicationTokens.purpose, purpose)
      )
    )
  const [found] = lock ? await query.for("update") : await query
  if (!found) return null
  const [application] = await hydrate(q, [found.application])
  const [run] = await q
    .select({ releasedAt: labApplicationProvisioning.releasedAt })
    .from(labApplicationProvisioning)
    .where(eq(labApplicationProvisioning.applicationId, application.id))
  return {
    application,
    tokenCreatedAt: found.tokenCreatedAt,
    releasedAt: run?.releasedAt ?? null,
  }
}

function actorOf(row: { actorKind: string; actorId: string | null }) {
  // A deleted member leaves actor_id null (ON DELETE SET NULL).
  if (row.actorKind === "admin") {
    return row.actorId === null
      ? { kind: "admin" as const, id: null }
      : { kind: "admin" as const, id: row.actorId }
  }
  return { kind: row.actorKind } as RecordedActor
}

/** Events by application id, in id order. */
async function loadEvents(
  q: Q,
  ids: string[],
  kinds?: readonly EventKind[]
): Promise<Map<string, EventRecord[]>> {
  if (ids.length === 0) return new Map()
  const rows = await q
    .select()
    .from(labApplicationEvents)
    .where(
      and(
        inArray(labApplicationEvents.applicationId, ids),
        kinds ? inArray(labApplicationEvents.kind, [...kinds]) : undefined
      )
    )
    .orderBy(asc(labApplicationEvents.id))
  const map = new Map<string, EventRecord[]>()
  for (const row of rows) {
    const record: EventRecord = {
      id: row.id,
      kind: row.kind as EventKind,
      actor: actorOf(row),
      changes: row.changes ?? null,
      at: row.createdAt,
    }
    const list = map.get(row.applicationId)
    if (list) list.push(record)
    else map.set(row.applicationId, [record])
  }
  return map
}

export async function loadPasswordMail(
  q: Q,
  applicationId: string
): Promise<PasswordMailState> {
  const events = await loadEvents(q, [applicationId], PASSWORD_MAIL_EVENT_KINDS)
  return derivePasswordMail(
    (events.get(applicationId) ?? []) as PasswordMailEvent[]
  )
}

const historyColumns = {
  id: labApplications.id,
  email: labApplications.email,
  status: labApplications.status,
  createdAt: labApplications.createdAt,
  closedAt: labApplications.closedAt,
}

function historyRow(r: {
  id: string
  status: string
  createdAt: Date
  closedAt: Date | null
}): HistoryRow {
  return {
    id: r.id,
    status: r.status as ApplicationStatus,
    createdAt: r.createdAt,
    closedAt: r.closedAt,
  }
}

export async function loadHistory(
  q: Q,
  email: Email,
  exceptId: string
): Promise<HistoryRow[]> {
  const rows = await q
    .select(historyColumns)
    .from(labApplications)
    .where(
      and(
        eq(labApplications.email, email.value),
        ne(labApplications.id, exceptId),
        ne(labApplications.status, "unverified")
      )
    )
    .orderBy(asc(labApplications.createdAt), asc(labApplications.id))
  return rows.map(historyRow)
}

export async function loadClaimedUsernames(
  q: Q,
  names: readonly Username[],
  exceptId?: string
): Promise<Set<string>> {
  if (names.length === 0) return new Set()
  const rows = await q
    .select({ username: labApplications.assignedUsername })
    .from(labApplications)
    .where(
      and(
        eq(labApplications.status, "provisioning"),
        inArray(
          labApplications.assignedUsername,
          names.map((n) => n.value)
        ),
        exceptId === undefined ? undefined : ne(labApplications.id, exceptId)
      )
    )
  return new Set(rows.flatMap((r) => (r.username === null ? [] : [r.username])))
}

async function loadList(q: Q, closed: boolean): Promise<ReviewRow[]> {
  // Open: an active status, or accepted with the run not yet released.
  const open = sql`(${inArray(labApplications.status, [...ACTIVE])} or (${labApplications.status} = 'accepted' and ${labApplicationProvisioning.releasedAt} is null))`
  const rows = await q
    .select({ application: labApplications })
    .from(labApplications)
    .leftJoin(
      labApplicationProvisioning,
      eq(labApplicationProvisioning.applicationId, labApplications.id)
    )
    .where(
      and(
        ne(labApplications.status, "unverified"),
        closed ? sql`not ${open}` : open
      )
    )
    .orderBy(asc(labApplications.createdAt), asc(labApplications.id))
  const appRows = rows.map((r) => r.application)
  const ids = appRows.map((r) => r.id)
  const emails = [
    ...new Set(appRows.flatMap((r) => (r.email === null ? [] : [r.email]))),
  ]
  const [applications, runs, events, others] = await Promise.all([
    hydrate(q, appRows),
    loadRuns(q, ids, false),
    loadEvents(q, ids),
    emails.length === 0
      ? Promise.resolve([])
      : q
          .select(historyColumns)
          .from(labApplications)
          .where(inArray(labApplications.email, emails))
          .orderBy(asc(labApplications.createdAt), asc(labApplications.id)),
  ])
  const byEmail = groupBy(
    others.filter((o) => o.email !== null),
    (o) => o.email as string
  )
  return applications.map((application, i) => {
    const row = appRows[i]
    return {
      application,
      run: runs.get(row.id) ?? null,
      events: events.get(row.id) ?? [],
      history:
        row.email === null
          ? []
          : (byEmail.get(row.email) ?? [])
              .filter((o) => o.id !== row.id)
              .map(historyRow),
    }
  })
}

/** Reads outside any transaction; takes no locks. */
export function applicationReader(db: Db): ApplicationReader {
  return {
    byToken: (hash, purpose) => loadByToken(db, hash, purpose, false),
    list: ({ closed }) => loadList(db, closed),
    passwordMail: (id) => loadPasswordMail(db, id),
    claimedUsernames: (names, exceptId) =>
      loadClaimedUsernames(db, names, exceptId),
    history: (email, exceptId) => loadHistory(db, email, exceptId),
  }
}
