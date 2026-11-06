// A booking's Teams meeting. The portal asks the GitLab pipeline to create,
// update or cancel it and the pipeline answers minutes later on
// /api/rooms/meeting-callback; until then the invite's link
// (/rooms/join/<booking>) says the meeting is on its way. Not actions:
// the callback is the pipeline, not a member, and the rest runs inside
// booking actions or the daily run.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm"

import { announceChange } from "@/lib/actions/changes"
import { queueMail } from "@/lib/actions/mail"
import { mailBody } from "@/lib/mail-body"
import { db } from "@/lib/db"
import { roomBookings, roomMeetingRequests, user } from "@/lib/db/schema"
import {
  helperConfigured,
  helperJobOutcome,
  meetingPipelineConfigured,
  openEpicIssues,
  triggerHelperPipeline,
  triggerMeetingPipeline,
} from "@/lib/gitlab"
import { meetAction, meetConfigured, meetHost } from "@/lib/meet"
import { agendaItems } from "@/lib/rooms/agenda"
import { MEETING_FAILURES, plainTitle, teamsSubject } from "@/lib/rooms/meeting"
import { dayLabel, taipeiOffsetIso } from "@/lib/rooms/time"

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

/** Online meetings happen somewhere: on meet, or through the Teams pipeline. */
const meetingsConfigured = () => meetConfigured() || meetingPipelineConfigured()

export const joinUrl = (bookingId: string) =>
  `${process.env.BETTER_AUTH_URL}/rooms/join/${bookingId}`

type Booking = typeof roomBookings.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Ask = { booking: Booking; variables: Record<string, string> }

/**
 * Asks the pipeline for a booking's Teams meeting, or to cancel it. The
 * request row is written first: a fast pipeline can call back before the
 * trigger's own response arrives. A trigger that fails is recorded as a
 * failure here, since it will never call back. Returns why it failed.
 */
async function ask(
  booking: Booking,
  kind: "create" | "update" | "cancel",
  variables: Record<string, string>
) {
  return askIf(kind, async () => ({ booking, variables }))
}

/**
 * ask, when decide (run in the transaction that records the request)
 * still wants it; null from decide asks nothing.
 */
async function askIf(
  kind: "create" | "update" | "cancel",
  decide: (tx: Tx) => Promise<Ask | null>
) {
  const requestId = `room-booking-${randomBytes(6).toString("hex")}`
  const callbackToken = randomBytes(32).toString("hex")
  const asked = await db.transaction(async (tx) => {
    const wanted = await decide(tx)
    if (!wanted) return null
    await tx.insert(roomMeetingRequests).values({
      requestId,
      bookingId: wanted.booking.id,
      kind,
      callbackTokenHash: sha256(callbackToken),
      ...(kind === "cancel"
        ? {}
        : { subject: wanted.booking.title, agenda: wanted.booking.agenda }),
    })
    return wanted
  })
  if (!asked) return null
  const { booking, variables } = asked
  if (meetConfigured()) return askMeet(requestId, kind, booking, variables)
  try {
    const pipelineId = await triggerMeetingPipeline({
      REQUEST_ID: requestId,
      CALLBACK_TOKEN: callbackToken,
      ACTION: kind,
      SUBJECT: teamsSubject(booking),
      ...(booking.groupName ? { GROUP_NAME: booking.groupName } : {}),
      ...(booking.issueRefs.length
        ? { ISSUE_REFS: booking.issueRefs.join(",") }
        : {}),
      ...variables,
    })
    if (pipelineId)
      await db
        .update(roomMeetingRequests)
        .set({ pipelineId })
        .where(eq(roomMeetingRequests.requestId, requestId))
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(roomMeetingRequests)
      .set({
        status: "failed",
        errorCode: "TRIGGER_FAILED",
        errorMessage: message,
        completedAt: sql`now()`,
      })
      .where(eq(roomMeetingRequests.requestId, requestId))
    return message
  }
}

/**
 * What meet shows as the booking's agenda: its lines, then the epic's open
 * child issues. GitLab not answering leaves the lines alone and says so.
 */
export async function bookingAgenda(booking: Booking) {
  const ref = booking.issueRefs[0]
  if (!ref) return { items: agendaItems(booking.agenda, []), gitlab: "ok" }
  try {
    const issues = await openEpicIssues(ref)
    return { items: agendaItems(booking.agenda, issues), gitlab: "ok" }
  } catch {
    return { items: agendaItems(booking.agenda, []), gitlab: "unavailable" }
  }
}

/**
 * The meet side of ask: books, renames or cancels the room on meet right
 * away and settles the request row itself, since meet answers in the call.
 * The create request's id is the booking id meet files recordings under;
 * an update or cancel names it as BOOKING_REQUEST_ID. The room name goes
 * in cancelId and "meet" in messageId so the Teams-era checks for "a
 * meeting was made" keep working. Once meet has answered, winlab-helper is
 * asked for the record epic (notifyHelper); that never fails the booking.
 * Returns why it failed, or null.
 */
async function askMeet(
  requestId: string,
  kind: "create" | "update" | "cancel",
  booking: Booking,
  variables: Record<string, string>
) {
  const target = kind === "create" ? requestId : variables.BOOKING_REQUEST_ID
  try {
    let joinUrl: string | null = null
    let roomName: string | null = null
    if (kind === "create") {
      const [who] = await db
        .select({ username: user.username })
        .from(user)
        .where(eq(user.id, booking.requestedBy))
      const { items } = await bookingAgenda(booking)
      const room = await meetAction<{ name: string; url: string }>(
        "schedule_room",
        {
          agenda: items,
          // meet files by group and opener; the [prefix]- is for Teams.
          title: plainTitle(booking),
          group: booking.groupName ?? undefined,
          booking: target,
          startsAt: taipeiOffsetIso(booking.date, booking.startTime),
          endsAt: taipeiOffsetIso(booking.date, booking.endTime),
          opener: who?.username ?? undefined,
        }
      )
      joinUrl = room.url
      roomName = room.name
    } else if (kind === "update") {
      const { items } = await bookingAgenda(booking)
      const room = await meetAction<{ name: string; url: string }>(
        "update_scheduled_room",
        {
          agenda: items,
          booking: target,
          title: plainTitle(booking),
          group: booking.groupName ?? undefined,
          startsAt: taipeiOffsetIso(booking.date, booking.startTime),
          endsAt: taipeiOffsetIso(booking.date, booking.endTime),
        }
      )
      roomName = room.name
    } else {
      await meetAction("cancel_scheduled_room", { booking: target })
    }
    await db
      .update(roomMeetingRequests)
      .set({
        status: "success",
        joinUrl,
        cancelId: roomName,
        messageId: roomName ? "meet" : null,
        optionsApplied: kind === "create",
        completedAt: sql`now()`,
        // Marked before the helper is told, so a crash in between leaves
        // something reconcileTeams retries.
        ...(helperConfigured() ? { helperError: HELPER_UNSENT } : {}),
      })
      .where(eq(roomMeetingRequests.requestId, requestId))
    await announceChange("meet_room").catch(() => {})
    // Not awaited: the member's request does not wait on GitLab.
    void notifyHelper(requestId)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(roomMeetingRequests)
      .set({
        status: "failed",
        errorCode: "MEET_FAILED",
        errorMessage: message,
        completedAt: sql`now()`,
      })
      .where(eq(roomMeetingRequests.requestId, requestId))
    return message
  }
}

/**
 * Asks winlab-helper's `meeting_open` to open, update or close the record
 * epic of a meet booking, the job teams-meeting-bot did in the Teams era.
 * REQUEST_ID is always the create request's id, the one the epic is
 * stamped with. Records the pipeline or the error on the request row; an
 * error is retried by reconcileTeams, which also checks how the pipeline's
 * job ended. A no-op without the trigger token. Never throws: the meet
 * request it follows has already succeeded.
 */
async function notifyHelper(requestId: string, triesSeen?: number) {
  if (!helperConfigured()) return
  // The try is counted and stamped before the trigger, and a retry claims
  // it only if nobody else did since it looked: two overlapping runs send
  // one, and the stamp keeps a later run off it during the grace.
  const [claimed] = await db
    .update(roomMeetingRequests)
    .set({
      helperTries: sql`${roomMeetingRequests.helperTries} + 1`,
      helperAskedAt: sql`now()`,
    })
    .where(
      and(
        eq(roomMeetingRequests.requestId, requestId),
        triesSeen === undefined
          ? undefined
          : eq(roomMeetingRequests.helperTries, triesSeen)
      )
    )
    .returning({ id: roomMeetingRequests.id })
    .catch(() => [])
  if (!claimed) return
  try {
    await tellHelper(requestId)
  } catch (error) {
    await db
      .update(roomMeetingRequests)
      .set({
        helperError: error instanceof Error ? error.message : String(error),
      })
      .where(eq(roomMeetingRequests.requestId, requestId))
      .catch(() => {})
  }
}

async function tellHelper(requestId: string) {
  const [row] = await db
    .select({ request: roomMeetingRequests, booking: roomBookings })
    .from(roomMeetingRequests)
    .innerJoin(roomBookings, eq(roomBookings.id, roomMeetingRequests.bookingId))
    .where(eq(roomMeetingRequests.requestId, requestId))
  if (!row) return
  const { request, booking } = row
  // Nothing to tell yet: clear the marker so it is not retried or mailed.
  const clear = () =>
    db
      .update(roomMeetingRequests)
      .set({ helperError: null })
      .where(eq(roomMeetingRequests.requestId, requestId))
  const [created] = await db
    .select({
      requestId: roomMeetingRequests.requestId,
      joinUrl: roomMeetingRequests.joinUrl,
    })
    .from(roomMeetingRequests)
    .where(
      and(
        eq(roomMeetingRequests.bookingId, booking.id),
        eq(roomMeetingRequests.kind, "create"),
        eq(roomMeetingRequests.status, "success")
      )
    )
    .orderBy(desc(roomMeetingRequests.createdAt))
    .limit(1)
  if (!created) return clear()
  const [who] = await db
    .select({ username: user.username })
    .from(user)
    .where(eq(user.id, booking.requestedBy))
  const pipelineId = await triggerHelperPipeline({
    REQUEST_ID: created.requestId,
    KIND: request.kind,
    // As stored: plain for new bookings, "[prefix]-title" for Teams-era
    // ones, which winlab-helper still files under their old names.
    SUBJECT: booking.title,
    ...(request.kind === "cancel" ? {} : createVariables(booking)),
    ...(request.kind === "cancel"
      ? { START_TIME: taipeiOffsetIso(booking.date, booking.startTime) }
      : {}),
    ...(booking.groupName ? { GROUP_NAME: booking.groupName } : {}),
    ...(who?.username ? { PERSON: who.username } : {}),
    ...(booking.issueRefs.length
      ? { ISSUE_REFS: booking.issueRefs.join(",") }
      : {}),
    ...(created.joinUrl ? { MEETING_URL: created.joinUrl } : {}),
  })
  await db
    .update(roomMeetingRequests)
    .set({
      helperPipelineId: pipelineId,
      helperError: null,
      helperSettledAt: pipelineId ? null : sql`now()`,
    })
    .where(eq(roomMeetingRequests.requestId, requestId))
}

const createVariables = (booking: Booking) => ({
  START_TIME: taipeiOffsetIso(booking.date, booking.startTime),
  END_TIME: taipeiOffsetIso(booking.date, booking.endTime),
  ...(booking.agenda ? { AGENDA: booking.agenda } : {}),
  ...(booking.deliverables.length
    ? { DELIVERABLES: booking.deliverables.join(",") }
    : {}),
})

/** Asks for the Teams meeting of a booking just made. */
export async function requestTeamsMeeting(booking: Booking) {
  if (!booking.online || !meetingsConfigured()) return
  await ask(booking, "create", createVariables(booking))
}

const cancelVariables = (
  booking: Booking,
  meeting: { requestId: string; cancelId: string; messageId: string }
) => ({
  BOOKING_REQUEST_ID: meeting.requestId,
  // The 04000000… GlobalObjectId, not the Outlook event id.
  EVENT_ID: meeting.cancelId,
  MESSAGE_ID: meeting.messageId,
  START_TIME: taipeiOffsetIso(booking.date, booking.startTime),
  CANCELLATION_MESSAGE: "此會議已取消（教室預約已取消）",
})

/**
 * Where the booking's Teams meeting stands against its current title:
 * "busy" while a create or update is still out or no meeting exists yet,
 * "current" when the last one asked for that title (a failed update is
 * not asked again; the daily run mails it), else "stale" with the create
 * request whose meeting to rename. On Teams only the title counts: an
 * update posts in the channel, and an agenda alone is not worth that. On
 * meet the agenda counts too, since the room's checklist shows it.
 */
async function teamsTopicState(tx: Tx, booking: Booking) {
  const asked = await tx
    .select()
    .from(roomMeetingRequests)
    .where(
      and(
        eq(roomMeetingRequests.bookingId, booking.id),
        inArray(roomMeetingRequests.kind, ["create", "update"])
      )
    )
    .orderBy(desc(roomMeetingRequests.createdAt))
  const meeting = asked.find(
    (row) => row.kind === "create" && row.cancelId && row.messageId
  )
  if (!meeting || asked.some((row) => row.status === "pending"))
    return { state: "busy" as const }
  const last = asked[0]!
  const current =
    last.subject === booking.title &&
    (!meetConfigured() || (last.agenda ?? null) === (booking.agenda ?? null))
  return current
    ? { state: "current" as const }
    : {
        state: "stale" as const,
        meeting: {
          requestId: meeting.requestId,
          cancelId: meeting.cancelId!,
          messageId: meeting.messageId!,
        },
      }
}

/**
 * Renames a booking's Teams meeting to its current title and agenda,
 * keeping the meeting and its link, when Teams shows another title. The
 * booking row is locked while deciding, so two callers ask once. Returns
 * why the ask failed, or null.
 */
export async function renameTeamsMeeting(bookingId: string) {
  if (!meetingsConfigured()) return null
  return askIf("update", async (tx) => {
    const [booking] = await tx
      .select()
      .from(roomBookings)
      .where(eq(roomBookings.id, bookingId))
      .for("update")
    if (!booking || booking.status !== "booked" || !booking.online) return null
    const topic = await teamsTopicState(tx, booking)
    if (topic.state !== "stale") return null
    const start = taipeiOffsetIso(booking.date, booking.startTime)
    return {
      booking,
      variables: {
        BOOKING_REQUEST_ID: topic.meeting.requestId,
        // The same 04000000… GlobalObjectId a cancellation sends.
        EVENT_ID: topic.meeting.cancelId,
        MESSAGE_ID: topic.meeting.messageId,
        START_TIME: start,
        END_TIME: taipeiOffsetIso(booking.date, booking.endTime),
        ORIGINAL_START_TIME: start,
        ...(booking.agenda ? { AGENDA: booking.agenda } : {}),
      },
    }
  })
}

// A Teams meeting is taken down at most this many times before the
// organizer is mailed to delete it by hand.
const CANCEL_TRIES = 3
// winlab-helper is asked for a meet booking's record at most this often.
const HELPER_TRIES = 3
// helperError until the trigger answers: a crash before then is retried.
const HELPER_UNSENT = "portal 在通知 winlab-helper 之前中斷"
// How long a fresh ask is left to its own notifyHelper before a retry.
const HELPER_GRACE_MINUTES = 2

/** The Teams meeting a booking's create request made, if Teams named it:
 * a success, or a failure that still made one (a link that is not a
 * Teams link). */
async function madeMeeting(tx: Tx | typeof db, bookingId: string) {
  const created = await tx
    .select()
    .from(roomMeetingRequests)
    .where(
      and(
        eq(roomMeetingRequests.bookingId, bookingId),
        eq(roomMeetingRequests.kind, "create")
      )
    )
    .orderBy(desc(roomMeetingRequests.createdAt))
  const meeting = created.find((row) => row.cancelId && row.messageId)
  return {
    meeting: meeting
      ? {
          requestId: meeting.requestId,
          cancelId: meeting.cancelId!,
          messageId: meeting.messageId!,
        }
      : null,
    succeeded: created.some((row) => row.status === "success"),
  }
}

/** A booking's cancel requests: one still out or done, and how many failed. */
async function cancelsOf(tx: Tx | typeof db, bookingId: string) {
  const rows = await tx
    .select({ status: roomMeetingRequests.status })
    .from(roomMeetingRequests)
    .where(
      and(
        eq(roomMeetingRequests.bookingId, bookingId),
        eq(roomMeetingRequests.kind, "cancel")
      )
    )
  return {
    settled: rows.some((row) => row.status !== "failed"),
    failed: rows.filter((row) => row.status === "failed").length,
  }
}

/**
 * Takes down a cancelled booking's Teams meeting. Returns why it could not,
 * since a meeting left behind still starts and records; null when it was
 * handed over, never existed, is already being taken down, or is still
 * being made (its callback then sees the booking cancelled and takes it
 * down itself). The booking row is locked while deciding, so the callback
 * and a cancel arriving together ask once.
 */
export async function cancelTeamsMeeting(booking: Booking) {
  if (!booking.online || !meetingsConfigured()) return null
  let missing = false
  const error = await askIf("cancel", async (tx) => {
    const [row] = await tx
      .select()
      .from(roomBookings)
      .where(eq(roomBookings.id, booking.id))
      .for("update")
    if (!row || row.status === "booked") return null
    const made = await madeMeeting(tx, row.id)
    if (!made.meeting) {
      missing = made.succeeded
      return null
    }
    const cancels = await cancelsOf(tx, row.id)
    if (cancels.settled || cancels.failed >= CANCEL_TRIES) return null
    return { booking: row, variables: cancelVariables(row, made.meeting) }
  })
  return error ?? (missing ? "Teams 沒有回報會議識別碼" : null)
}

/**
 * Whether the week's lab meeting has a cancelled booking (from today on)
 * whose Teams meeting may still be up: one still being made, or one made
 * and not yet taken down with tries left. A new booking for that week
 * waits, or two Teams meetings would start and record. Stops waiting once
 * the take-down has failed CANCEL_TRIES times or the creation failed with
 * no meeting to take down (the organizer was mailed either way).
 */
export async function takedownPending(meetingId: string) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date())
  const cancelled = await db
    .select({ id: roomBookings.id })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.meetingId, meetingId),
        eq(roomBookings.status, "cancelled"),
        eq(roomBookings.online, true),
        sql`${roomBookings.date} >= ${today}`
      )
    )
  for (const { id } of cancelled) {
    const making = await db
      .select({ id: roomMeetingRequests.id })
      .from(roomMeetingRequests)
      .where(
        and(
          eq(roomMeetingRequests.bookingId, id),
          eq(roomMeetingRequests.kind, "create"),
          eq(roomMeetingRequests.status, "pending")
        )
      )
    if (making.length) return true
    const made = await madeMeeting(db, id)
    if (!made.meeting) continue
    const rows = await db
      .select({ status: roomMeetingRequests.status })
      .from(roomMeetingRequests)
      .where(
        and(
          eq(roomMeetingRequests.bookingId, id),
          eq(roomMeetingRequests.kind, "cancel")
        )
      )
    if (rows.some((row) => row.status === "success")) continue
    if (rows.filter((row) => row.status === "failed").length >= CANCEL_TRIES)
      continue
    return true
  }
  return false
}

/** The latest create request of each booking, for showing its link. */
export async function meetingsOf(bookingIds: string[]) {
  if (!bookingIds.length) return new Map<string, MeetingState>()
  const rows = await db
    .selectDistinctOn([roomMeetingRequests.bookingId], {
      bookingId: roomMeetingRequests.bookingId,
      status: roomMeetingRequests.status,
      joinUrl: roomMeetingRequests.joinUrl,
      errorCode: roomMeetingRequests.errorCode,
      errorMessage: roomMeetingRequests.errorMessage,
    })
    .from(roomMeetingRequests)
    .where(
      and(
        eq(roomMeetingRequests.kind, "create"),
        inArray(roomMeetingRequests.bookingId, bookingIds)
      )
    )
    .orderBy(roomMeetingRequests.bookingId, desc(roomMeetingRequests.createdAt))
  return new Map(
    rows.map((row) => [
      row.bookingId,
      {
        status: row.status as MeetingState["status"],
        joinUrl: row.joinUrl,
        error: row.errorCode
          ? row.errorCode === "MEET_FAILED" && row.errorMessage
            ? `${MEETING_FAILURES.MEET_FAILED}：${row.errorMessage}`
            : (MEETING_FAILURES[row.errorCode] ?? row.errorCode)
          : null,
      },
    ])
  )
}

export type MeetingState = {
  status: "pending" | "success" | "failed"
  joinUrl: string | null
  error: string | null
}

// The pipeline's answer. A creation succeeded when a join_url came back,
// whatever the status says: OPTIONS_FAILED means the meeting exists without
// auto-recording, and asking again would make a second one. An update or a
// cancellation has only its status; an update keeps the create's link.
type Callback = {
  request_id?: unknown
  action?: unknown
  status?: unknown
  stage?: unknown
  meeting?: Record<string, unknown> | null
  options_applied?: unknown
  error?: { code?: unknown; message?: unknown } | null
  pipeline?: { id?: unknown; url?: unknown } | null
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value : null

/** Applies a callback; answers like an HTTP route would. The pipeline
 * retries a non-2xx, so a repeat of an applied answer is a quiet 200. */
export async function applyMeetingCallback(
  token: string,
  body: Callback,
  headerRequestId: string | null
): Promise<{ status: number; body: Record<string, unknown> }> {
  const requestId = text(body.request_id)
  if (!requestId) return { status: 400, body: { error: "missing request_id" } }
  if (headerRequestId && headerRequestId !== requestId)
    return { status: 400, body: { error: "X-Request-Id does not match" } }
  const [request] = await db
    .select()
    .from(roomMeetingRequests)
    .where(eq(roomMeetingRequests.requestId, requestId))
  // An unknown id and a wrong token look the same to the caller.
  const presented = Buffer.from(sha256(token), "hex")
  const stored = Buffer.from(request?.callbackTokenHash ?? "", "hex")
  if (
    !request ||
    stored.length !== presented.length ||
    !timingSafeEqual(stored, presented)
  )
    return { status: 401, body: { error: "unauthorized" } }
  const action =
    body.action === "cancel" || body.action === "update"
      ? body.action
      : "create"
  if (action !== request.kind)
    return {
      status: 400,
      body: { error: `action ${action} is not ${request.kind}` },
    }
  if (request.status !== "pending")
    return { status: 200, body: { ok: true, duplicate: true } }

  const errorCode = text(body.error?.code)
  const pipeline = {
    stage: text(body.stage),
    pipelineId: text(body.pipeline?.id) ?? request.pipelineId,
    pipelineUrl: text(body.pipeline?.url),
    completedAt: sql`now()`,
  }
  // Only a Teams or meet link may become the invite's redirect.
  const rawJoin = text(body.meeting?.join_url)
  const join =
    rawJoin &&
    (/^https:\/\/teams\.microsoft\.com\//.test(rawJoin) ||
      rawJoin.startsWith(`https://${meetHost()}/`))
      ? rawJoin
      : null
  const succeeded =
    action === "create"
      ? join !== null
      : body.status === "success" && !errorCode
  const cancelId = text(body.meeting?.cancel_id)
  const messageId = text(body.meeting?.message_id)
  await db
    .update(roomMeetingRequests)
    .set(
      succeeded
        ? {
            ...pipeline,
            status: "success",
            joinUrl: join,
            cancelId,
            messageId,
            optionsApplied:
              body.options_applied === true && errorCode !== "OPTIONS_FAILED",
          }
        : {
            ...pipeline,
            status: "failed",
            // A creation that failed only for its link still made a meeting,
            // which a cancellation must be able to take down.
            cancelId,
            messageId,
            errorCode:
              errorCode ??
              (rawJoin && !join ? "INVALID_JOIN_URL" : "UNEXPECTED_RESPONSE"),
            errorMessage: text(body.error?.message) ?? "pipeline 沒有說明原因",
          }
    )
    .where(eq(roomMeetingRequests.id, request.id))
  // Cancelled while the meeting was being made: take it down now. A failed
  // ask records a failed cancel request, which the scheduler retries.
  if (action === "create" && (succeeded || (cancelId && messageId))) {
    const [booking] = await db
      .select()
      .from(roomBookings)
      .where(eq(roomBookings.id, request.bookingId))
    if (booking && booking.status !== "booked") {
      if (cancelId && messageId) await cancelTeamsMeeting(booking)
      else
        await db.insert(roomMeetingRequests).values({
          requestId: `room-booking-${randomBytes(6).toString("hex")}`,
          bookingId: booking.id,
          kind: "cancel",
          callbackTokenHash: sha256(randomBytes(32).toString("hex")),
          status: "failed",
          errorCode: "CANCEL_FAILED",
          errorMessage: "預約已取消，但 Teams 沒有回報會議識別碼",
          completedAt: sql`now()`,
        })
    }
  }
  await announceChange("room_meeting_callback").catch(() => {})
  return { status: 200, body: { ok: true } }
}

/** Where the invite's link should go now. */
export async function meetingForJoin(bookingId: string) {
  const [booking] = await db
    .select({ status: roomBookings.status, online: roomBookings.online })
    .from(roomBookings)
    .where(eq(roomBookings.id, bookingId))
  if (!booking) return { state: "missing" as const }
  if (booking.status !== "booked") return { state: "cancelled" as const }
  if (!booking.online) return { state: "offline" as const }
  const meeting = (await meetingsOf([bookingId])).get(bookingId)
  if (meeting?.status === "success" && meeting.joinUrl)
    return { state: "ready" as const, url: meeting.joinUrl }
  if (!meeting || meeting.status === "pending")
    return { state: "pending" as const }
  return { state: "failed" as const }
}

const STUCK_MINUTES = 30
// A booking older than this with no create request lost it to a restart
// between its commit and the ask.
const ORPHAN_MINUTES = 10
// A meet room that could not be made is asked for again, this many times
// in all, so a fix on meet's side heals the booking without a rebook.
const MEET_CREATE_TRIES = 5
// Failures that made nothing anywhere, so asking again cannot double up.
const RETRYABLE_CREATE = ["MEET_FAILED", "TRIGGER_FAILED"]

/**
 * Every scheduler tick: asks again for what a restart or a failed call
 * left undone. A booking that never asked for its Teams meeting asks now,
 * and a cancelled booking whose Teams meeting is still up asks to take it
 * down again, up to CANCEL_TRIES times. Only meetings not over yet: a
 * past one has already happened.
 */
export async function reconcileTeams() {
  if (!meetingsConfigured()) return
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date())
  const now = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Taipei",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date())
  // Not over yet: a later day, or today before its end.
  const ahead = sql`(${roomBookings.date} > ${today} or (${roomBookings.date} = ${today} and ${roomBookings.endTime} > ${now}))`
  const asked = sql`exists (select 1 from ${roomMeetingRequests} where ${roomMeetingRequests.bookingId} = ${roomBookings.id} and ${roomMeetingRequests.kind} = 'create')`
  const orphans = await db
    .select()
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.status, "booked"),
        eq(roomBookings.online, true),
        ahead,
        lt(
          roomBookings.createdAt,
          sql`now() - make_interval(mins => ${ORPHAN_MINUTES})`
        ),
        sql`not ${asked}`
      )
    )
  for (const booking of orphans)
    await askIf("create", async (tx) => {
      // Locked and checked again, so two runs of this ask once.
      const [row] = await tx
        .select()
        .from(roomBookings)
        .where(eq(roomBookings.id, booking.id))
        .for("update")
      if (!row || row.status !== "booked") return null
      const [existing] = await tx
        .select({ id: roomMeetingRequests.id })
        .from(roomMeetingRequests)
        .where(
          and(
            eq(roomMeetingRequests.bookingId, row.id),
            eq(roomMeetingRequests.kind, "create")
          )
        )
      return existing ? null : { booking: row, variables: createVariables(row) }
    })
  if (meetConfigured()) await retryMeetCreates(ahead)
  const cancelled = await db
    .select()
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.status, "cancelled"),
        eq(roomBookings.online, true),
        ahead,
        sql`exists (select 1 from ${roomMeetingRequests} where ${roomMeetingRequests.bookingId} = ${roomBookings.id} and ${roomMeetingRequests.kind} = 'create' and ${roomMeetingRequests.cancelId} is not null and ${roomMeetingRequests.messageId} is not null)`,
        sql`not exists (select 1 from ${roomMeetingRequests} where ${roomMeetingRequests.bookingId} = ${roomBookings.id} and ${roomMeetingRequests.kind} = 'cancel' and ${roomMeetingRequests.status} <> 'failed')`
      )
    )
  // A helper pipeline that was accepted but not yet seen to finish: a
  // failed meeting_open job counts as untold, so it is asked again below.
  const unsettled = await db
    .select({
      requestId: roomMeetingRequests.requestId,
      pipelineId: roomMeetingRequests.helperPipelineId,
    })
    .from(roomMeetingRequests)
    .where(
      and(
        isNotNull(roomMeetingRequests.helperPipelineId),
        isNull(roomMeetingRequests.helperError),
        isNull(roomMeetingRequests.helperSettledAt),
        // A pipeline GitLab lost or never ran is not polled forever.
        sql`${roomMeetingRequests.bookingId} in (select ${roomBookings.id} from ${roomBookings} where ${roomBookings.date} >= ${today}::date - 2)`
      )
    )
  for (const { requestId, pipelineId } of unsettled) {
    const outcome = await helperJobOutcome(pipelineId!)
    if (outcome === "running" || outcome === "unknown") continue
    await db
      .update(roomMeetingRequests)
      .set(
        outcome === "done"
          ? { helperSettledAt: sql`now()` }
          : {
              helperError: `winlab-helper 的 meeting_open 沒有完成（pipeline ${pipelineId}）`,
            }
      )
      .where(
        and(
          eq(roomMeetingRequests.requestId, requestId),
          eq(roomMeetingRequests.helperPipelineId, pipelineId!),
          isNull(roomMeetingRequests.helperSettledAt)
        )
      )
  }
  // A record epic winlab-helper was not told about, while the meeting is
  // still ahead. Opening or updating one stops once the booking is cancelled.
  // A fresh ask is left a moment for its own notifyHelper.
  const untold = await db
    .select({
      requestId: roomMeetingRequests.requestId,
      tries: roomMeetingRequests.helperTries,
    })
    .from(roomMeetingRequests)
    .innerJoin(roomBookings, eq(roomBookings.id, roomMeetingRequests.bookingId))
    .where(
      and(
        isNotNull(roomMeetingRequests.helperError),
        lt(roomMeetingRequests.helperTries, HELPER_TRIES),
        lt(
          sql`coalesce(${roomMeetingRequests.helperAskedAt}, ${roomMeetingRequests.completedAt})`,
          sql`now() - make_interval(mins => ${HELPER_GRACE_MINUTES})`
        ),
        ahead,
        or(
          eq(roomMeetingRequests.kind, "cancel"),
          eq(roomBookings.status, "booked")
        )
      )
    )
  for (const { requestId, tries } of untold)
    await notifyHelper(requestId, tries)
  for (const booking of cancelled) {
    const { failed } = await cancelsOf(db, booking.id)
    if (failed >= CANCEL_TRIES) continue
    // A retry is coming: its earlier failures need no mail of their own.
    if (failed > 0)
      await db
        .update(roomMeetingRequests)
        .set({ notifiedAt: sql`now()` })
        .where(
          and(
            eq(roomMeetingRequests.bookingId, booking.id),
            eq(roomMeetingRequests.kind, "cancel"),
            eq(roomMeetingRequests.status, "failed"),
            isNull(roomMeetingRequests.notifiedAt)
          )
        )
    await cancelTeamsMeeting(booking)
  }
}

/**
 * Asks meet again for the room of an upcoming booking whose every create
 * failed without making anything (meet refused it or was down), at most
 * MEET_CREATE_TRIES times. The earlier failures were mailed already or
 * need no mail now that a retry is coming.
 */
async function retryMeetCreates(ahead: ReturnType<typeof sql>) {
  const creates = sql`(select count(*) from ${roomMeetingRequests} where ${roomMeetingRequests.bookingId} = ${roomBookings.id} and ${roomMeetingRequests.kind} = 'create')`
  const retryable = sql`(select count(*) from ${roomMeetingRequests} where ${roomMeetingRequests.bookingId} = ${roomBookings.id} and ${roomMeetingRequests.kind} = 'create' and ${roomMeetingRequests.status} = 'failed' and ${roomMeetingRequests.messageId} is null and ${roomMeetingRequests.errorCode} in ${RETRYABLE_CREATE} and ${roomMeetingRequests.completedAt} < now() - make_interval(mins => ${ORPHAN_MINUTES}))`
  const failed = await db
    .select({ id: roomBookings.id })
    .from(roomBookings)
    .where(
      and(
        eq(roomBookings.status, "booked"),
        eq(roomBookings.online, true),
        ahead,
        sql`${creates} > 0`,
        sql`${creates} = ${retryable}`,
        sql`${creates} < ${MEET_CREATE_TRIES}`
      )
    )
  for (const { id } of failed)
    await askIf("create", async (tx) => {
      // Locked and checked again, so two runs ask once.
      const [row] = await tx
        .select()
        .from(roomBookings)
        .where(eq(roomBookings.id, id))
        .for("update")
      if (!row || row.status !== "booked") return null
      const asked = await tx
        .select({
          status: roomMeetingRequests.status,
          errorCode: roomMeetingRequests.errorCode,
          messageId: roomMeetingRequests.messageId,
        })
        .from(roomMeetingRequests)
        .where(
          and(
            eq(roomMeetingRequests.bookingId, row.id),
            eq(roomMeetingRequests.kind, "create")
          )
        )
      const allFailed = asked.every(
        (r) =>
          r.status === "failed" &&
          !r.messageId &&
          RETRYABLE_CREATE.includes(r.errorCode ?? "")
      )
      if (!asked.length || !allFailed || asked.length >= MEET_CREATE_TRIES)
        return null
      await tx
        .update(roomMeetingRequests)
        .set({ notifiedAt: sql`now()` })
        .where(
          and(
            eq(roomMeetingRequests.bookingId, row.id),
            eq(roomMeetingRequests.kind, "create"),
            isNull(roomMeetingRequests.notifiedAt)
          )
        )
      return { booking: row, variables: createVariables(row) }
    })
}

/**
 * Part of the daily run: requests with no answer after 30 minutes are
 * failures (a crashed runner never calls back), and each failure that
 * matters is mailed to whoever booked, once.
 */
export async function sweepMeetingRequests() {
  await db
    .update(roomMeetingRequests)
    .set({
      status: "failed",
      errorCode: "NO_CALLBACK",
      errorMessage: `超過 ${STUCK_MINUTES} 分鐘沒有回報`,
      completedAt: sql`now()`,
    })
    .where(
      and(
        eq(roomMeetingRequests.status, "pending"),
        lt(
          roomMeetingRequests.createdAt,
          sql`now() - make_interval(mins => ${STUCK_MINUTES})`
        )
      )
    )
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
  }).format(new Date())
  const failed = await db
    .select({
      id: roomMeetingRequests.id,
      bookingId: roomMeetingRequests.bookingId,
      kind: roomMeetingRequests.kind,
      errorCode: roomMeetingRequests.errorCode,
      errorMessage: roomMeetingRequests.errorMessage,
      pipelineUrl: roomMeetingRequests.pipelineUrl,
      bookingStatus: roomBookings.status,
      title: roomBookings.title,
      meetingPrefix: roomBookings.meetingPrefix,
      date: roomBookings.date,
      startTime: roomBookings.startTime,
      endTime: roomBookings.endTime,
      email: user.email,
    })
    .from(roomMeetingRequests)
    .innerJoin(roomBookings, eq(roomBookings.id, roomMeetingRequests.bookingId))
    .innerJoin(user, eq(user.id, roomBookings.requestedBy))
    .where(
      and(
        eq(roomMeetingRequests.status, "failed"),
        isNull(roomMeetingRequests.notifiedAt)
      )
    )
  for (const row of failed) {
    // reconcileTeams will try that take-down again: mail only the last.
    // One with no meeting ids to send cannot be retried and is mailed now.
    if (
      row.kind === "cancel" &&
      row.date >= today &&
      (await madeMeeting(db, row.bookingId)).meeting &&
      (await cancelsOf(db, row.bookingId)).failed < CANCEL_TRIES
    )
      continue
    await db.transaction(async (tx) => {
      // Claimed first, so two sweeps at once mail it once.
      const [claimed] = await tx
        .update(roomMeetingRequests)
        .set({ notifiedAt: sql`now()` })
        .where(
          and(
            eq(roomMeetingRequests.id, row.id),
            isNull(roomMeetingRequests.notifiedAt)
          )
        )
        .returning({ id: roomMeetingRequests.id })
      if (!claimed) return
      // A failed creation for a booking since cancelled leaves nothing to do.
      if (row.kind === "cancel" || row.bookingStatus === "booked") {
        const reason = `${MEETING_FAILURES[row.errorCode ?? ""] ?? row.errorCode}（${row.errorMessage ?? ""}）`
        await queueMail(tx, {
          to: [row.email],
          subject:
            row.kind === "cancel"
              ? `[WinLab 會議] Teams 會議沒有取消：${plainTitle(row)}`
              : row.kind === "update"
                ? `[WinLab 會議] Teams 會議名稱沒有更新：${plainTitle(row)}`
                : `[WinLab 會議] 會議連結建立失敗：${plainTitle(row)}`,
          ...mailBody({
            title: plainTitle(row),
            rows: [
              [
                "時間",
                `${dayLabel(row.date)} ${row.startTime} 到 ${row.endTime}`,
              ],
              ["原因", reason],
            ],
            paragraphs: [
              row.kind === "cancel"
                ? "預約已取消，但 Teams 會議還在，時間到仍會開始並錄影，請到 Teams 手動刪除。"
                : row.kind === "update"
                  ? "會議和連結都沒變，但 Teams 上還是舊的名稱，錄影也會用舊名稱存檔。"
                  : row.errorCode === "INVALID_JOIN_URL"
                    ? "Teams 會議已經建立，但邀請裡的連結打不開，請到 Teams 頻道找這場會議。取消預約時會一併取消它。"
                    : "教室預約不受影響，但這場會議沒有 Teams 連結，需要的話請在 Teams 手動開。",
            ],
            action: row.pipelineUrl
              ? { label: "查看 Pipeline", url: row.pipelineUrl }
              : undefined,
          }),
        })
      }
    })
  }
  await mailUntoldRecords(today)
}

/**
 * A meet booking whose record epic winlab-helper was never told about,
 * after HELPER_TRIES tries or once the meeting is over: the booker is
 * mailed once per booking, since the recording will then file under no
 * epic. A cancel the helper never heard of is mailed too, as its own mail,
 * but only when the create reached the helper: otherwise no epic exists.
 */
async function mailUntoldRecords(today: string) {
  const rows = await db
    .select({
      id: roomMeetingRequests.id,
      bookingId: roomMeetingRequests.bookingId,
      kind: roomMeetingRequests.kind,
      helperError: roomMeetingRequests.helperError,
      title: roomBookings.title,
      meetingPrefix: roomBookings.meetingPrefix,
      date: roomBookings.date,
      startTime: roomBookings.startTime,
      endTime: roomBookings.endTime,
      email: user.email,
    })
    .from(roomMeetingRequests)
    .innerJoin(roomBookings, eq(roomBookings.id, roomMeetingRequests.bookingId))
    .innerJoin(user, eq(user.id, roomBookings.requestedBy))
    .where(
      and(
        isNotNull(roomMeetingRequests.helperError),
        isNull(roomMeetingRequests.helperNotifiedAt),
        or(
          eq(roomMeetingRequests.kind, "cancel"),
          eq(roomBookings.status, "booked")
        ),
        sql`(${roomMeetingRequests.helperTries} >= ${HELPER_TRIES} or ${roomBookings.date} < ${today})`
      )
    )
  // One mail per booking and side: the cancel apart from create and update.
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = `${row.bookingId}:${row.kind === "cancel" ? "cancel" : "open"}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  for (const group of groups.values())
    await db.transaction(async (tx) => {
      const [first] = group
      const cancel = first.kind === "cancel"
      // Locked, so a second sweep waits and then sees what this one mailed.
      await tx
        .select({ id: roomBookings.id })
        .from(roomBookings)
        .where(eq(roomBookings.id, first.bookingId))
        .for("update")
      // Another request on this side is still being retried: mail when it
      // has settled, unless the meeting is already over.
      if (first.date >= today) {
        const [retrying] = await tx
          .select({ id: roomMeetingRequests.id })
          .from(roomMeetingRequests)
          .where(
            and(
              eq(roomMeetingRequests.bookingId, first.bookingId),
              cancel
                ? eq(roomMeetingRequests.kind, "cancel")
                : ne(roomMeetingRequests.kind, "cancel"),
              isNotNull(roomMeetingRequests.helperError),
              lt(roomMeetingRequests.helperTries, HELPER_TRIES),
              isNull(roomMeetingRequests.helperNotifiedAt)
            )
          )
          .limit(1)
        if (retrying) return
      }
      const claimed = await tx
        .update(roomMeetingRequests)
        .set({ helperNotifiedAt: sql`now()` })
        .where(
          and(
            inArray(
              roomMeetingRequests.id,
              group.map((row) => row.id)
            ),
            isNull(roomMeetingRequests.helperNotifiedAt)
          )
        )
        .returning({
          id: roomMeetingRequests.id,
          kind: roomMeetingRequests.kind,
          helperError: roomMeetingRequests.helperError,
        })
      if (!claimed.length) return
      const others = await tx
        .select({
          kind: roomMeetingRequests.kind,
          helperPipelineId: roomMeetingRequests.helperPipelineId,
          helperError: roomMeetingRequests.helperError,
          helperNotifiedAt: roomMeetingRequests.helperNotifiedAt,
        })
        .from(roomMeetingRequests)
        .where(
          and(
            eq(roomMeetingRequests.bookingId, first.bookingId),
            notInArray(
              roomMeetingRequests.id,
              claimed.map((row) => row.id)
            )
          )
        )
      // The create reached the helper, so an epic was opened.
      const opened = others.some(
        (row) =>
          row.kind === "create" &&
          row.helperPipelineId !== null &&
          row.helperError === null
      )
      if (cancel && !opened) return
      // This booking's open side was already mailed.
      if (
        !cancel &&
        others.some((row) => row.kind !== "cancel" && row.helperNotifiedAt)
      )
        return
      const created = !claimed.some((row) => row.kind === "create") && opened
      await queueMail(tx, {
        to: [first.email],
        subject: cancel
          ? `[WinLab 會議] GitLab 會議紀錄沒有關閉：${plainTitle(first)}`
          : created
            ? `[WinLab 會議] GitLab 會議紀錄沒有更新：${plainTitle(first)}`
            : `[WinLab 會議] GitLab 會議紀錄沒有建立：${plainTitle(first)}`,
        ...mailBody({
          title: plainTitle(first),
          rows: [
            [
              "時間",
              `${dayLabel(first.date)} ${first.startTime} 到 ${first.endTime}`,
            ],
            [
              "原因",
              (claimed.find((row) => row.kind === "create") ?? claimed[0])
                .helperError ?? "",
            ],
          ],
          paragraphs: [
            cancel
              ? "會議已取消，但 GitLab 上這場會議的紀錄 epic 還開著，請到 GitLab 手動關閉或通知管理員。"
              : created
                ? "會議連結不受影響，但 GitLab 上這場會議的紀錄 epic 還是舊的時間或議程，請到 GitLab 手動更新或通知管理員。"
                : "會議連結不受影響，但 GitLab 上沒有這場會議的紀錄 epic，錄影會歸到未對應的區域，請到 GitLab 手動建立或通知管理員。",
          ],
        }),
      })
    })
}

/**
 * What GitLab polls every 30 minutes to keep one marker comment per issue.
 * Cancelled rows stay with their status: a row that disappears could mean
 * cancelled, finished or a broken endpoint, and the reader must not guess.
 * join_url is the portal's link, valid before the Teams meeting exists.
 */
export async function bookingsFeed(from: string, to: string) {
  const rows = await db
    .select()
    .from(roomBookings)
    .where(
      and(
        sql`${roomBookings.date} >= ${from}`,
        sql`${roomBookings.date} <= ${to}`
      )
    )
    .orderBy(roomBookings.date, roomBookings.startTime)
  return rows.map((row) => ({
    booking_id: row.id,
    start: taipeiOffsetIso(row.date, row.startTime),
    end: taipeiOffsetIso(row.date, row.endTime),
    room: row.room,
    title: row.title,
    status: row.status === "booked" ? "confirmed" : "cancelled",
    join_url: row.online ? joinUrl(row.id) : null,
    issue_refs: row.issueRefs,
    group_name: row.groupName,
    agenda: row.agenda,
    deliverables: row.deliverables,
  }))
}
