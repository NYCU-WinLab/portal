// A booking's Teams meeting. The portal asks the GitLab pipeline to create,
// update or cancel it and the pipeline answers minutes later on
// /api/rooms/meeting-callback; until then the invite's link
// (/rooms/join/<booking>) says the meeting is on its way. Not actions:
// the callback is the pipeline, not a member, and the rest runs inside
// booking actions or the daily run.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"

import { announceChange } from "@/lib/actions/changes"
import { queueMail } from "@/lib/actions/mail"
import { mailBody } from "@/lib/mail-body"
import { db } from "@/lib/db"
import { roomBookings, roomMeetingRequests, user } from "@/lib/db/schema"
import { meetingPipelineConfigured, triggerMeetingPipeline } from "@/lib/gitlab"
import { meetAction, meetConfigured, meetHost } from "@/lib/meet"
import { MEETING_FAILURES } from "@/lib/rooms/meeting"
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
      SUBJECT: booking.title,
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
 * The meet side of ask: books, renames or cancels the room on meet right
 * away and settles the request row itself, since meet answers in the call.
 * The create request's id is the booking id meet files recordings under;
 * an update or cancel names it as BOOKING_REQUEST_ID. The room name goes
 * in cancelId and "meet" in messageId so the Teams-era checks for "a
 * meeting was made" keep working. Returns why it failed, or null.
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
      const room = await meetAction<{ name: string; url: string }>(
        "schedule_room",
        {
          title: booking.title,
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
      const room = await meetAction<{ name: string; url: string }>(
        "update_scheduled_room",
        {
          booking: target,
          title: booking.title,
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
      })
      .where(eq(roomMeetingRequests.requestId, requestId))
    await announceChange("meet_room").catch(() => {})
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
 * request whose meeting to rename. Only the title counts: an update posts
 * in the channel, and an agenda alone is not worth that.
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
  return asked[0]!.subject === booking.title
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
          ? (MEETING_FAILURES[row.errorCode] ?? row.errorCode)
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
              ? `[WinLab 會議] Teams 會議沒有取消：${row.title}`
              : row.kind === "update"
                ? `[WinLab 會議] Teams 會議名稱沒有更新：${row.title}`
                : `[WinLab 會議] 會議連結建立失敗：${row.title}`,
          ...mailBody({
            title: row.title,
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
