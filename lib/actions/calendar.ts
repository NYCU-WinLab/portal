import { and, asc, eq, gt, lt, sql } from "drizzle-orm"
import { createHash } from "node:crypto"

import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { isLabMember } from "@/lib/auth/member"
import { feedKey, open, sameKey, seal } from "@/lib/calendar-crypto"
import { db } from "@/lib/db"
import {
  calendarEvents,
  calendarFeeds,
  calendarLinks,
  user,
} from "@/lib/db/schema"
import {
  accessTokenFor,
  busyEvents,
  exchangeCode,
  googleCalendarConfigured,
  GrantRevoked,
  revoke,
} from "@/lib/google-calendar"
import { emitErrorLog } from "@/lib/otel"
import { fold, icsText, icsTime } from "@/lib/rooms/meeting"
import { addDays, isCalendarDay, todayInTaipei } from "@/lib/rooms/time"

// Members link their Google Calendar; the portal copies the events that make
// them busy (14 days back, 90 ahead) every 5 minutes. Others see a private
// calendar as busy blocks and a public one with titles and locations. Each
// member gets a subscription link per calendar for their own calendar app.

const SYNC_EVERY_MS = 5 * 60_000
const BACK_DAYS = 14
const AHEAD_DAYS = 90
const BUSY = "忙碌"

const visibility = z.enum(["private", "public"])

type Row = typeof calendarEvents.$inferSelect

/** What the viewer may see of one event. */
function shown(row: Row, full: boolean) {
  const visible = full && !row.private
  return {
    start: row.startsAt.toISOString(),
    end: row.endsAt.toISOString(),
    allDay: row.allDay,
    title: visible ? row.title || "（無標題）" : BUSY,
    location: visible ? row.location : "",
    busyOnly: !visible,
  }
}

const seesAll = (
  viewerId: string,
  link: { userId: string; visibility: string }
) => viewerId === link.userId || link.visibility === "public"

async function feedVersion(userId: string) {
  const [row] = await db
    .select({ version: calendarFeeds.version })
    .from(calendarFeeds)
    .where(eq(calendarFeeds.userId, userId))
  return row?.version ?? 1
}

function feedUrl(viewerId: string, version: number, ownerId: string) {
  return `${process.env.BETTER_AUTH_URL}/api/calendar/feed/${viewerId}/${feedKey(viewerId, version)}/${ownerId}.ics`
}

/** Copies the member's busy events from Google, replacing what was kept. */
async function syncOne(userId: string) {
  const [link] = await db
    .select()
    .from(calendarLinks)
    .where(eq(calendarLinks.userId, userId))
  if (!link) return
  const now = new Date()
  try {
    const accessToken = await accessTokenFor(open(link.refreshToken))
    const events = await busyEvents(
      accessToken,
      new Date(now.getTime() - BACK_DAYS * 86_400_000),
      new Date(now.getTime() + AHEAD_DAYS * 86_400_000)
    )
    await db.transaction(async (tx) => {
      await tx.delete(calendarEvents).where(eq(calendarEvents.userId, userId))
      if (events.length > 0)
        await tx
          .insert(calendarEvents)
          .values(events.map((event) => ({ ...event, userId })))
          .onConflictDoNothing()
      await tx
        .update(calendarLinks)
        .set({ syncedAt: now, syncError: null })
        .where(eq(calendarLinks.userId, userId))
    })
  } catch (error) {
    const revoked = error instanceof GrantRevoked
    // A relink while this sync ran replaced the token: its answer is stale.
    const same = and(
      eq(calendarLinks.userId, userId),
      eq(calendarLinks.refreshToken, link.refreshToken)
    )
    const [still] = await db
      .update(calendarLinks)
      .set({
        syncError: revoked ? error.message : "同步失敗，5 分鐘後再試",
      })
      .where(same)
      .returning({ userId: calendarLinks.userId })
    // Events from a calendar the portal can no longer read would mislead.
    if (revoked && still)
      await db.delete(calendarEvents).where(eq(calendarEvents.userId, userId))
    if (!revoked) emitErrorLog(error, { "calendar.user_id": userId })
  }
}

/** A member who left the lab: their calendar stops showing and Google
 * drops the portal's access. */
async function dropLink(userId: string) {
  const [removed] = await db
    .delete(calendarLinks)
    .where(eq(calendarLinks.userId, userId))
    .returning({ refreshToken: calendarLinks.refreshToken })
  if (!removed) return
  try {
    await revoke(open(removed.refreshToken))
  } catch {
    // Gone from the portal either way.
  }
}

/** Syncs every linked calendar, one at a time; once per server process. */
export function startCalendarSync() {
  if (!googleCalendarConfigured() || !process.env.CALENDAR_SECRET) return
  let running = false
  const run = () => {
    if (running) return
    running = true
    void (async () => {
      const links = await db
        .select({ userId: calendarLinks.userId })
        .from(calendarLinks)
      for (const { userId } of links) {
        const member = await isLabMember(userId).catch(() => null)
        if (member === false) await dropLink(userId)
        else if (member) await syncOne(userId)
      }
    })()
      .catch((error: unknown) => emitErrorLog(error, {}))
      .finally(() => (running = false))
  }
  setInterval(run, SYNC_EVERY_MS).unref()
  run()
}

export const linkGoogleCalendar = defineAction({
  name: "link_google_calendar",
  title: "連結 Google 行事曆",
  description:
    "Finishes the Google sign-in that links the member's Google Calendar, with the code Google sent back.",
  kind: "mutation",
  input: z.object({ code: z.string().min(1), verifier: z.string().min(43) }),
  mcpExcludedBecause:
    "Linking needs the member's own consent on Google's page in a browser.",
  run: async (actor, { code, verifier }) => {
    const granted = await exchangeCode(code, verifier)
    const [old] = await db
      .select({
        refreshToken: calendarLinks.refreshToken,
        googleEmail: calendarLinks.googleEmail,
      })
      .from(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
    await db
      .insert(calendarLinks)
      .values({
        userId: actor.userId,
        googleEmail: granted.email,
        refreshToken: seal(granted.refreshToken),
      })
      .onConflictDoUpdate({
        target: calendarLinks.userId,
        set: {
          googleEmail: granted.email,
          refreshToken: seal(granted.refreshToken),
          syncError: null,
        },
      })
    if (old) {
      const previous = (() => {
        try {
          return open(old.refreshToken)
        } catch {
          return null
        }
      })()
      if (previous && previous !== granted.refreshToken) await revoke(previous)
    }
    await syncOne(actor.userId)
    return { email: granted.email }
  },
})

export const getMyCalendar = defineAction({
  name: "get_my_calendar",
  title: "我的行事曆設定",
  description:
    "Whether the signed-in member has linked a Google Calendar: the Google address, visibility (private: others see busy blocks only; public: others also see titles and locations), when it last synced and any sync problem.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [link] = await db
      .select({
        googleEmail: calendarLinks.googleEmail,
        visibility: calendarLinks.visibility,
        syncedAt: calendarLinks.syncedAt,
        syncError: calendarLinks.syncError,
      })
      .from(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
    return {
      configured: googleCalendarConfigured(),
      link: link
        ? {
            ...link,
            visibility: link.visibility as z.infer<typeof visibility>,
            syncedAt: link.syncedAt?.toISOString() ?? null,
          }
        : null,
    }
  },
})

export const setCalendarVisibility = defineAction({
  name: "set_calendar_visibility",
  title: "行事曆公開範圍",
  description:
    "Sets who sees what on the signed-in member's linked calendar: private shows others only busy blocks, public also shows each event's title and location. Events the member marked private in Google stay busy blocks either way. Confirm with the member before making a calendar public.",
  kind: "mutation",
  input: z.object({ visibility }),
  run: async (actor, input) => {
    const updated = await db
      .update(calendarLinks)
      .set({ visibility: input.visibility })
      .where(eq(calendarLinks.userId, actor.userId))
      .returning({ visibility: calendarLinks.visibility })
    if (updated.length === 0) throw new Error("還沒有連結 Google 行事曆")
    return input
  },
})

export const unlinkGoogleCalendar = defineAction({
  name: "unlink_google_calendar",
  title: "取消連結行事曆",
  description:
    "Unlinks the signed-in member's Google Calendar: tells Google to drop the portal's access and deletes every copied event, so nobody sees it any more.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    const [removed] = await db
      .delete(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
      .returning({ refreshToken: calendarLinks.refreshToken })
    if (!removed) throw new Error("還沒有連結 Google 行事曆")
    try {
      await revoke(open(removed.refreshToken))
    } catch {
      // The link is gone either way; Google drops unused grants on its own.
    }
    return { unlinked: true }
  },
})

export const listCalendars = defineAction({
  name: "list_calendars",
  title: "行事曆列表",
  description:
    "Members who linked a Google Calendar, with each one's visibility (private or public) and whether they are busy right now. Open one with get_member_calendar.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const now = new Date()
    const [links, current] = await Promise.all([
      db
        .select({
          userId: calendarLinks.userId,
          name: user.name,
          visibility: calendarLinks.visibility,
          syncedAt: calendarLinks.syncedAt,
        })
        .from(calendarLinks)
        .innerJoin(user, eq(user.id, calendarLinks.userId))
        .orderBy(asc(user.name)),
      db
        .selectDistinct({ userId: calendarEvents.userId })
        .from(calendarEvents)
        .where(
          and(lt(calendarEvents.startsAt, now), gt(calendarEvents.endsAt, now))
        ),
    ])
    const busy = new Set(current.map((row) => row.userId))
    return {
      calendars: links.map((link) => ({
        ...link,
        visibility: link.visibility as z.infer<typeof visibility>,
        syncedAt: link.syncedAt?.toISOString() ?? null,
        busyNow: busy.has(link.userId),
      })),
    }
  },
})

export const getMemberCalendar = defineAction({
  name: "get_member_calendar",
  title: "查看行事曆",
  description:
    "One member's linked calendar for `days` days from `from` (YYYY-MM-DD in Taipei, default today): each event's start and end (ISO), allDay, and title and location when the owner made it public (else title is 忙碌 and busyOnly is true). Also the subscription link (ICS) the signed-in member can add to their own calendar app; it is theirs alone, so never share it.",
  kind: "query",
  input: z.object({
    user_id: z.uuid(),
    from: z.string().refine(isCalendarDay, "日期要是 YYYY-MM-DD").optional(),
    days: z.number().int().min(1).max(31).default(7),
  }),
  run: async (actor, input) => {
    const [link] = await db
      .select({
        userId: calendarLinks.userId,
        name: user.name,
        visibility: calendarLinks.visibility,
        syncedAt: calendarLinks.syncedAt,
        syncError: calendarLinks.syncError,
      })
      .from(calendarLinks)
      .innerJoin(user, eq(user.id, calendarLinks.userId))
      .where(eq(calendarLinks.userId, input.user_id))
    if (!link) throw new Error("這位成員沒有連結行事曆")
    const from = input.from ?? todayInTaipei()
    const start = new Date(`${from}T00:00:00+08:00`)
    const end = new Date(`${addDays(from, input.days)}T00:00:00+08:00`)
    const rows = await db
      .select()
      .from(calendarEvents)
      .where(
        and(
          eq(calendarEvents.userId, link.userId),
          lt(calendarEvents.startsAt, end),
          gt(calendarEvents.endsAt, start)
        )
      )
      .orderBy(asc(calendarEvents.startsAt))
    const full = seesAll(actor.userId, link)
    return {
      userId: link.userId,
      name: link.name,
      visibility: link.visibility as z.infer<typeof visibility>,
      syncedAt: link.syncedAt?.toISOString() ?? null,
      syncError: actor.userId === link.userId ? link.syncError : null,
      from,
      days: input.days,
      events: rows.map((row) => shown(row, full)),
      feedUrl: feedUrl(
        actor.userId,
        await feedVersion(actor.userId),
        link.userId
      ),
    }
  },
})

export const rotateCalendarFeeds = defineAction({
  name: "rotate_calendar_feeds",
  title: "重設訂閱連結",
  description:
    "Ends every calendar subscription link the signed-in member has (for example after one leaked) and makes new ones; calendar apps subscribed with the old links stop updating.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    const [row] = await db
      .insert(calendarFeeds)
      .values({ userId: actor.userId, version: 2 })
      .onConflictDoUpdate({
        target: calendarFeeds.userId,
        set: { version: sql`${calendarFeeds.version} + 1` },
      })
      .returning({ version: calendarFeeds.version })
    return { version: row.version }
  },
})

// Stays the same across syncs (rows are replaced each time), so calendar
// apps keep their reminders on an unchanged event.
const eventUid = (row: Row) =>
  `${createHash("sha256").update(`${row.userId}:${row.googleId}`).digest("hex").slice(0, 32)}@portal.winlab.tw`

const icsDate = (date: Date) => todayInTaipeiOf(date).replace(/-/g, "")
const todayInTaipeiOf = (date: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)

/**
 * The ICS a calendar app fetches from a subscription link: the owner's
 * events as the link's member may see them. null when the link is wrong or
 * its member is no longer in the lab.
 */
export async function calendarFeed(
  viewerId: string,
  key: string,
  ownerId: string
): Promise<string | null> {
  const ids = z.uuid()
  if (!ids.safeParse(viewerId).success || !ids.safeParse(ownerId).success)
    return null
  if (!sameKey(key, feedKey(viewerId, await feedVersion(viewerId)))) return null
  if (!(await isLabMember(viewerId))) return null
  const [link] = await db
    .select({
      userId: calendarLinks.userId,
      name: user.name,
      visibility: calendarLinks.visibility,
    })
    .from(calendarLinks)
    .innerJoin(user, eq(user.id, calendarLinks.userId))
    .where(eq(calendarLinks.userId, ownerId))
  if (!link) return null
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.userId, ownerId))
    .orderBy(asc(calendarEvents.startsAt))
  const full = seesAll(viewerId, link)
  const stamp = icsTime(new Date().toISOString())
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WinLab//portal.winlab.tw//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`${link.name}（WinLab）`)}`,
    "X-WR-TIMEZONE:Asia/Taipei",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    ...rows.flatMap((row) => {
      const event = shown(row, full)
      return [
        "BEGIN:VEVENT",
        `UID:${eventUid(row)}`,
        `DTSTAMP:${stamp}`,
        ...(row.allDay
          ? [
              `DTSTART;VALUE=DATE:${icsDate(row.startsAt)}`,
              `DTEND;VALUE=DATE:${icsDate(row.endsAt)}`,
            ]
          : [`DTSTART:${icsTime(event.start)}`, `DTEND:${icsTime(event.end)}`]),
        `SUMMARY:${icsText(event.title)}`,
        ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
        "TRANSP:OPAQUE",
        ...(event.busyOnly ? ["CLASS:PRIVATE"] : []),
        "END:VEVENT",
      ]
    }),
    "END:VCALENDAR",
  ]
  return lines.map(fold).join("\r\n") + "\r\n"
}
