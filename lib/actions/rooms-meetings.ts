// A booking's Teams meeting. The portal asks the GitLab pipeline to create
// or cancel it and the pipeline answers minutes later on
// /api/rooms/meeting-callback; until then the invite's link
// (/rooms/join/<booking>) says the meeting is on its way. Not actions:
// the callback is the pipeline, not a member, and the rest runs inside
// booking actions or the daily run.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm"

import { announceChange } from "@/lib/actions/changes"
import { queueMail } from "@/lib/actions/mail"
import { db } from "@/lib/db"
import { roomBookings, roomMeetingRequests, user } from "@/lib/db/schema"
import { meetingPipelineConfigured, triggerMeetingPipeline } from "@/lib/gitlab"
import { MEETING_FAILURES } from "@/lib/rooms/meeting"
import { dayLabel, taipeiOffsetIso } from "@/lib/rooms/time"

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

export const joinUrl = (bookingId: string) =>
  `${process.env.BETTER_AUTH_URL}/rooms/join/${bookingId}`

type Booking = typeof roomBookings.$inferSelect

/**
 * Asks the pipeline for a booking's Teams meeting, or to cancel it. The
 * request row is written first: a fast pipeline can call back before the
 * trigger's own response arrives. A trigger that fails is recorded as a
 * failure here, since it will never call back. Returns why it failed.
 */
async function ask(
  booking: Booking,
  kind: "create" | "cancel",
  variables: Record<string, string>
) {
  const requestId = `room-booking-${randomBytes(6).toString("hex")}`
  const callbackToken = randomBytes(32).toString("hex")
  await db.insert(roomMeetingRequests).values({
    requestId,
    bookingId: booking.id,
    kind,
    callbackTokenHash: sha256(callbackToken),
  })
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

/** Asks for the Teams meeting of a booking just made. */
export async function requestMeeting(booking: Booking) {
  if (!booking.online || !meetingPipelineConfigured()) return
  await ask(booking, "create", {
    START_TIME: taipeiOffsetIso(booking.date, booking.startTime),
    END_TIME: taipeiOffsetIso(booking.date, booking.endTime),
    ...(booking.agenda ? { AGENDA: booking.agenda } : {}),
    ...(booking.deliverables.length
      ? { DELIVERABLES: booking.deliverables.join(",") }
      : {}),
  })
}

/**
 * Takes down a cancelled booking's Teams meeting. Returns why it could not,
 * since a meeting left behind still starts and records; null when it was
 * handed over or never existed.
 */
export async function cancelMeeting(booking: Booking) {
  if (!booking.online || !meetingPipelineConfigured()) return null
  const created = await db
    .select()
    .from(roomMeetingRequests)
    .where(
      and(
        eq(roomMeetingRequests.bookingId, booking.id),
        eq(roomMeetingRequests.kind, "create")
      )
    )
    .orderBy(desc(roomMeetingRequests.createdAt))
  const meeting = created.find((row) => row.cancelId && row.messageId)
  if (!meeting)
    return created.some((row) => row.status !== "failed")
      ? "Teams 會議還沒建好，或沒有回報識別碼"
      : null
  return ask(booking, "cancel", {
    BOOKING_REQUEST_ID: meeting.requestId,
    // The 04000000… GlobalObjectId, not the Outlook event id.
    EVENT_ID: meeting.cancelId!,
    MESSAGE_ID: meeting.messageId!,
    START_TIME: taipeiOffsetIso(booking.date, booking.startTime),
    CANCELLATION_MESSAGE: "此會議已取消（教室預約已取消）",
  })
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
// auto-recording, and asking again would make a second one. A cancellation
// has only its status.
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
  const action = body.action === "cancel" ? "cancel" : "create"
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
  const join = text(body.meeting?.join_url)
  const succeeded =
    action === "cancel"
      ? body.status === "success" && !errorCode
      : join !== null
  await db
    .update(roomMeetingRequests)
    .set(
      succeeded
        ? {
            ...pipeline,
            status: "success",
            joinUrl: join,
            cancelId: text(body.meeting?.cancel_id),
            messageId: text(body.meeting?.message_id),
            optionsApplied:
              body.options_applied === true && errorCode !== "OPTIONS_FAILED",
          }
        : {
            ...pipeline,
            status: "failed",
            errorCode: errorCode ?? "UNEXPECTED_RESPONSE",
            errorMessage: text(body.error?.message) ?? "pipeline 沒有說明原因",
          }
    )
    .where(eq(roomMeetingRequests.id, request.id))
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
  const failed = await db
    .select({
      id: roomMeetingRequests.id,
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
    await db.transaction(async (tx) => {
      // A failed creation for a booking since cancelled leaves nothing to do.
      if (row.kind === "cancel" || row.bookingStatus === "booked") {
        const reason = `${MEETING_FAILURES[row.errorCode ?? ""] ?? row.errorCode}（${row.errorMessage ?? ""}）`
        await queueMail(tx, {
          to: [row.email],
          subject:
            row.kind === "cancel"
              ? `[WinLab 會議] Teams 會議沒有取消：${row.title}`
              : `[WinLab 會議] 會議連結建立失敗：${row.title}`,
          text: [
            `${dayLabel(row.date)} ${row.startTime} 到 ${row.endTime} ${row.title}`,
            "",
            row.kind === "cancel"
              ? "預約已取消，但 Teams 會議還在，時間到仍會開始並錄影，請到 Teams 手動刪除。"
              : "教室預約不受影響，但這場會議沒有 Teams 連結，需要的話請在 Teams 手動開。",
            "",
            `原因：${reason}`,
            ...(row.pipelineUrl ? [`Pipeline：${row.pipelineUrl}`] : []),
          ].join("\n"),
        })
      }
      await tx
        .update(roomMeetingRequests)
        .set({ notifiedAt: sql`now()` })
        .where(eq(roomMeetingRequests.id, row.id))
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
