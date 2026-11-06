import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  lt,
  notInArray,
  sql,
} from "drizzle-orm"
import { createHash } from "node:crypto"

import { z } from "zod"

import { portalMeetings } from "@/lib/actions/calendar-meetings"
import { onChange } from "@/lib/actions/changes"
import { defineAction } from "@/lib/actions/define"
import { isLabMember } from "@/lib/auth/member"
import { feedKey, open, sameKey, seal } from "@/lib/calendar-crypto"
import { db } from "@/lib/db"
import {
  appointmentSchedules,
  calendarEvents,
  calendarFeeds,
  calendarLinks,
  calendarSources,
  user,
} from "@/lib/db/schema"
import {
  accessTokenFor,
  busyBlocks,
  busyEvents,
  calendarList,
  CalendarGone,
  exchangeCode,
  googleCalendarConfigured,
  type GoogleCalendar,
  type GoogleEvent,
  GrantRevoked,
  LIST_SCOPE,
  revoke,
} from "@/lib/google-calendar"
import {
  fetchIcs,
  ICS_MAX_BYTES,
  icsAddress,
  IcsError,
  icsEvents,
} from "@/lib/ics"
import { emitErrorLog } from "@/lib/otel"
import { fold, icsText, icsTime } from "@/lib/rooms/meeting"
import { addDays, isCalendarDay, todayInTaipei } from "@/lib/rooms/time"

// The portal keeps one calendar per member, made of sources they choose:
// calendars of their linked Google account, ICS addresses (Outlook, Apple,
// course systems) and imported ICS files. Every 5 minutes it copies the
// events that make them busy (14 days back, 90 ahead). Each source has its
// own visibility: private shows others busy blocks, public also titles and
// locations. Each member gets a subscription link per calendar for their
// own calendar app.

const SYNC_EVERY_MS = 5 * 60_000
const BACK_DAYS = 14
const AHEAD_DAYS = 90
const BUSY = "忙碌"
const MAX_SOURCES = 20
const RETRY_LATER = "同步失敗，5 分鐘後再試"

const visibility = z.enum(["private", "public"])
type Visibility = z.infer<typeof visibility>
type Source = typeof calendarSources.$inferSelect

type Row = typeof calendarEvents.$inferSelect & {
  visibility: string
  accessRole: string | null
  kind: string
}

// "[nycu-robotics]-確認工作事項" is how Teams and mailed invites name a
// portal meeting; the portal itself says "確認工作事項".
const plainName = (title: string) =>
  title
    .replace(/^\[[^\]]*\]-/, "")
    .trim()
    .toLowerCase()
const place = (location: string) => location.replace(/\s+/g, "").toLowerCase()

/**
 * Drops the copies of a portal meeting that came in through another source
 * (the invite the member accepted into Google, an ICS of the same): same
 * start, and the same name or the same room. The portal's own copy stays.
 */
function withoutCopies<T extends Row>(rows: T[]) {
  const meetings = rows.filter((row) => row.kind === "portal")
  if (meetings.length === 0) return rows
  return rows.filter(
    (row) =>
      row.kind === "portal" ||
      !meetings.some((meeting) => {
        if (meeting.startsAt.getTime() !== row.startsAt.getTime()) return false
        if (plainName(meeting.title) === plainName(row.title)) return true
        const a = place(meeting.location)
        const b = place(row.location)
        return (
          a !== "" &&
          a !== "線上" &&
          b !== "" &&
          (a.includes(b) || b.includes(a))
        )
      })
  )
}

/** What the viewer may see of one event. */
function shown(row: Row, viewerId: string) {
  // A free/busy-only calendar never shows a title, whatever was kept.
  const visible =
    (viewerId === row.userId || row.visibility === "public") &&
    !row.private &&
    row.accessRole !== "freeBusyReader"
  return {
    start: row.startsAt.toISOString(),
    end: row.endsAt.toISOString(),
    allDay: row.allDay,
    title: visible ? row.title || "（無標題）" : BUSY,
    location: visible ? row.location : "",
    busyOnly: !visible,
  }
}

/** The events of a member's enabled sources, with each source's visibility. */
function eventsOf(userId: string, from?: Date, to?: Date) {
  return db
    .select({
      id: calendarEvents.id,
      userId: calendarEvents.userId,
      sourceId: calendarEvents.sourceId,
      googleId: calendarEvents.googleId,
      startsAt: calendarEvents.startsAt,
      endsAt: calendarEvents.endsAt,
      allDay: calendarEvents.allDay,
      title: calendarEvents.title,
      location: calendarEvents.location,
      private: calendarEvents.private,
      visibility: calendarSources.visibility,
      accessRole: calendarSources.accessRole,
      kind: calendarSources.kind,
    })
    .from(calendarEvents)
    .innerJoin(
      calendarSources,
      and(
        eq(calendarSources.id, calendarEvents.sourceId),
        eq(calendarSources.enabled, true)
      )
    )
    .where(
      and(
        eq(calendarEvents.userId, userId),
        ...(to ? [lt(calendarEvents.startsAt, to)] : []),
        ...(from ? [gt(calendarEvents.endsAt, from)] : [])
      )
    )
    .orderBy(asc(calendarEvents.startsAt))
}

/**
 * How current a member's calendar is: how many enabled sources of their own
 * it has (the meetings source not counted: meetings alone do not say when someone
 * is free, so they cannot take appointments on it), the oldest sync among
 * all enabled sources and the first problem.
 */
export async function calendarState(userId: string) {
  const [link] = await db
    .select({ syncError: calendarLinks.syncError })
    .from(calendarLinks)
    .where(eq(calendarLinks.userId, userId))
  const sources = await db
    .select({
      kind: calendarSources.kind,
      syncedAt: calendarSources.syncedAt,
      syncError: calendarSources.syncError,
    })
    .from(calendarSources)
    .where(
      and(eq(calendarSources.userId, userId), eq(calendarSources.enabled, true))
    )
  const times = sources.map((source) => source.syncedAt?.getTime() ?? 0)
  const usesGoogle = sources.some((source) => source.kind === "google")
  return {
    sources: sources.filter((source) => source.kind !== "portal").length,
    syncedAt:
      times.length && Math.min(...times) ? new Date(Math.min(...times)) : null,
    syncError:
      (usesGoogle ? link?.syncError : null) ??
      sources.find((source) => source.syncError)?.syncError ??
      null,
  }
}

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

/** A source's problem as the member reads it. */
function problem(error: unknown) {
  if (error instanceof IcsError || error instanceof CalendarGone)
    return error.message
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  )
    return "行事曆網址連不上，5 分鐘後再試"
  return RETRY_LATER
}

/** Keeps the member's Google sources in step with their calendar list. */
async function syncGoogleList(
  userId: string,
  link: { googleEmail: string; scopes: string },
  accessToken: string
) {
  const canList = link.scopes.split(" ").includes(LIST_SCOPE)
  const calendars: GoogleCalendar[] = canList
    ? await calendarList(accessToken)
    : [
        {
          id: link.googleEmail,
          summary: link.googleEmail,
          accessRole: "owner",
          primary: true,
        },
      ]
  for (const calendar of calendars) {
    // A calendar shared down to free/busy keeps no title or location: drop
    // what was copied while the member could read it.
    if (calendar.accessRole === "freeBusyReader")
      await db.delete(calendarEvents).where(
        inArray(
          calendarEvents.sourceId,
          db
            .select({ id: calendarSources.id })
            .from(calendarSources)
            .where(
              and(
                eq(calendarSources.userId, userId),
                eq(calendarSources.googleCalendarId, calendar.id),
                sql`${calendarSources.accessRole} is distinct from 'freeBusyReader'`
              )
            )
        )
      )
    await db
      .insert(calendarSources)
      .values({
        userId,
        kind: "google",
        label: calendar.summary,
        googleCalendarId: calendar.id,
        accessRole: calendar.accessRole,
        primary: calendar.primary,
        // A newly listed calendar stays off until the member turns it on;
        // the primary one is on, as it was before the portal listed others.
        enabled: calendar.primary,
      })
      .onConflictDoUpdate({
        target: [calendarSources.userId, calendarSources.googleCalendarId],
        set: {
          label: calendar.summary,
          accessRole: calendar.accessRole,
          primary: calendar.primary,
        },
      })
  }
  // A calendar gone from the list (unsubscribed, deleted) goes with its
  // events. Without the list scope only the primary one is known.
  if (canList)
    await db.delete(calendarSources).where(
      and(
        eq(calendarSources.userId, userId),
        eq(calendarSources.kind, "google"),
        notInArray(
          calendarSources.googleCalendarId,
          calendars.map((calendar) => calendar.id)
        )
      )
    )
}

async function readSource(
  source: Source,
  accessToken: string | null,
  from: Date,
  to: Date
): Promise<GoogleEvent[]> {
  if (source.kind === "google") {
    if (!accessToken) throw new Error("no Google access")
    return source.accessRole === "freeBusyReader"
      ? busyBlocks(accessToken, source.googleCalendarId!, from, to)
      : busyEvents(accessToken, source.googleCalendarId!, from, to)
  }
  if (source.kind === "portal") return portalMeetings(source.userId, from, to)
  if (source.kind === "ics")
    return icsEvents(await fetchIcs(open(source.url!)), from, to)
  return icsEvents(source.content!, from, to)
}

/** Replaces one source's events with what it holds now. */
async function syncSource(
  source: Source,
  accessToken: string | null,
  from: Date,
  to: Date
) {
  try {
    const events = await readSource(source, accessToken, from, to)
    await db.transaction(async (tx) => {
      await tx
        .delete(calendarEvents)
        .where(eq(calendarEvents.sourceId, source.id))
      if (events.length > 0)
        await tx
          .insert(calendarEvents)
          .values(
            events.map((event) => ({
              ...event,
              userId: source.userId,
              sourceId: source.id,
            }))
          )
          .onConflictDoNothing()
      await tx
        .update(calendarSources)
        .set({ syncedAt: new Date(), syncError: null })
        .where(eq(calendarSources.id, source.id))
    })
  } catch (error) {
    const message = problem(error)
    await db
      .update(calendarSources)
      .set({ syncError: message })
      .where(eq(calendarSources.id, source.id))
    // A calendar the portal can no longer read would mislead.
    if (error instanceof CalendarGone)
      await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.sourceId, source.id))
    if (message === RETRY_LATER)
      emitErrorLog(error, {
        "calendar.user_id": source.userId,
        "calendar.source_kind": source.kind,
      })
  }
}

const PORTAL_LABEL = "WinLab 會議"

/**
 * Gives the member the source of their portal meetings, on and public (every
 * member already sees every meeting in list_meetings); null when they have
 * it already.
 */
async function ensurePortalSource(userId: string) {
  const [created] = await db
    .insert(calendarSources)
    .values({
      userId,
      kind: "portal",
      label: PORTAL_LABEL,
      enabled: true,
      visibility: "public",
    })
    .onConflictDoNothing()
    .returning()
  return created ?? null
}

/** Copies every enabled source of one member, replacing what was kept. */
async function syncOne(userId: string, only?: string) {
  if (!only) await ensurePortalSource(userId)
  const now = new Date()
  const from = new Date(now.getTime() - BACK_DAYS * 86_400_000)
  const to = new Date(now.getTime() + AHEAD_DAYS * 86_400_000)
  const [link] = await db
    .select()
    .from(calendarLinks)
    .where(eq(calendarLinks.userId, userId))
  let accessToken: string | null = null
  if (link && googleCalendarConfigured())
    try {
      accessToken = await accessTokenFor(open(link.refreshToken))
      if (!only) await syncGoogleList(userId, link, accessToken)
      await db
        .update(calendarLinks)
        .set({ syncedAt: now, syncError: null })
        .where(eq(calendarLinks.userId, userId))
    } catch (error) {
      accessToken = null
      const revoked = error instanceof GrantRevoked
      // A relink while this sync ran replaced the token: its answer is stale.
      const [still] = await db
        .update(calendarLinks)
        .set({ syncError: revoked ? error.message : RETRY_LATER })
        .where(
          and(
            eq(calendarLinks.userId, userId),
            eq(calendarLinks.refreshToken, link.refreshToken)
          )
        )
        .returning({ userId: calendarLinks.userId })
      // Events from calendars the portal can no longer read would mislead.
      if (revoked && still) {
        const google = db
          .select({ id: calendarSources.id })
          .from(calendarSources)
          .where(
            and(
              eq(calendarSources.userId, userId),
              eq(calendarSources.kind, "google")
            )
          )
        await db
          .delete(calendarEvents)
          .where(inArray(calendarEvents.sourceId, google))
      }
      if (!revoked) emitErrorLog(error, { "calendar.user_id": userId })
    }
  const sources = await db
    .select()
    .from(calendarSources)
    .where(eq(calendarSources.userId, userId))
  for (const source of sources) {
    if (only && source.id !== only) continue
    if (!source.enabled) {
      await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.sourceId, source.id))
      continue
    }
    // Without Google access the link's syncError says why.
    if (source.kind === "google" && !accessToken) continue
    await syncSource(source, accessToken, from, to)
  }
}

const syncReady = () => Boolean(process.env.CALENDAR_SECRET)

/**
 * Syncs one member's calendar now, as a booking with them needs a current
 * answer; the outcome is in calendarState.
 */
export async function syncCalendar(userId: string) {
  if (syncReady()) await syncOne(userId)
}

/** A member who left the lab: their calendar stops showing and Google
 * drops the portal's access. */
async function dropCalendar(userId: string) {
  await db.delete(calendarSources).where(eq(calendarSources.userId, userId))
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

/** Syncs every member's calendar, one at a time; once per server process. */
export function startCalendarSync() {
  if (!syncReady()) return
  let running = false
  const run = () => {
    if (running) return
    running = true
    void (async () => {
      const owners = await db
        .selectDistinct({ userId: calendarSources.userId })
        .from(calendarSources)
      const linked = await db
        .select({ userId: calendarLinks.userId })
        .from(calendarLinks)
      const ids = new Set([...owners, ...linked].map((row) => row.userId))
      for (const userId of ids) {
        const member = await isLabMember(userId).catch(() => null)
        if (member === false) await dropCalendar(userId)
        else if (member) await syncOne(userId)
      }
    })()
      .catch((error: unknown) => emitErrorLog(error, {}))
      .finally(() => (running = false))
  }
  setInterval(run, SYNC_EVERY_MS).unref()
  run()
  // A meeting booked, moved or cancelled shows on everyone's calendar within
  // seconds, not at the next 5-minute run.
  let soon: ReturnType<typeof setTimeout> | null = null
  void onChange((action) => {
    if (!MEETING_ACTIONS.has(action) || soon) return
    soon = setTimeout(() => {
      soon = null
      void syncPortalSources().catch((error: unknown) =>
        emitErrorLog(error, {})
      )
    }, 2000)
  }).catch((error: unknown) => emitErrorLog(error, {}))
}

/** Actions that change who meets when. */
const MEETING_ACTIONS = new Set([
  "book_meeting",
  "update_meeting",
  "cancel_meeting",
  "book_appointment",
  "add_lab_meeting",
  "update_lab_meeting",
  "update_my_lab_meeting",
  "delete_lab_meeting",
  "swap_lab_meetings",
  "generate_semester",
  "add_presenter",
  "remove_presenter",
  "move_presenter",
  "fill_presenters",
  "set_standing_meeting_active",
  "delete_standing_meeting",
])

/** Re-reads every member's portal meetings source. */
export async function syncPortalSources() {
  const now = new Date()
  const from = new Date(now.getTime() - BACK_DAYS * 86_400_000)
  const to = new Date(now.getTime() + AHEAD_DAYS * 86_400_000)
  const sources = await db
    .select()
    .from(calendarSources)
    .where(
      and(eq(calendarSources.kind, "portal"), eq(calendarSources.enabled, true))
    )
  for (const source of sources) await syncSource(source, null, from, to)
}

export const linkGoogleCalendar = defineAction({
  name: "link_google_calendar",
  title: "連結 Google 行事曆",
  description:
    "Finishes the Google sign-in that links the member's Google account, with the code Google sent back.",
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
    const values = {
      googleEmail: granted.email,
      refreshToken: seal(granted.refreshToken),
      scopes: granted.scopes.join(" "),
      syncError: null,
    }
    await db
      .insert(calendarLinks)
      .values({ userId: actor.userId, ...values })
      .onConflictDoUpdate({ target: calendarLinks.userId, set: values })
    // Google keeps one grant per account: revoking the old token of the
    // same account would end the new one too. Only a switch to another
    // Google account drops the old grant and its calendars.
    if (old && old.googleEmail !== granted.email) {
      await db
        .delete(calendarSources)
        .where(
          and(
            eq(calendarSources.userId, actor.userId),
            eq(calendarSources.kind, "google")
          )
        )
      const previous = (() => {
        try {
          return open(old.refreshToken)
        } catch {
          return null
        }
      })()
      if (previous) await revoke(previous)
    }
    await syncOne(actor.userId)
    return { email: granted.email }
  },
})

type SourceKind = "portal" | "google" | "ics" | "file"

export const getMyCalendar = defineAction({
  name: "get_my_calendar",
  title: "我的行事曆設定",
  description:
    "The signed-in member's calendar setup. google is their linked Google account (null when none): its address, whether the portal may list all its calendars (canList; false means only the primary one, relink to grant more) and any sync problem. sources are the calendars that make up their portal calendar: kind google (one per calendar in the account; busyOnly when Google shares it as free/busy only), ics (an address, shown by host only), file (an imported .ics) or portal (WinLab 會議: portal meetings they booked, are invited to, of their project groups, booked with them, the weekly lab meeting, and meet rooms scheduled for their groups or by them; on and public by default); each has enabled, visibility (private: others see busy blocks; public: others also see titles and locations), when it last synced and any problem. Change one with set_calendar_source, add with add_calendar_source.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    // Every member who opens their calendar gets their meetings on it.
    const created = await ensurePortalSource(actor.userId)
    if (created) {
      const now = Date.now()
      await syncSource(
        created,
        null,
        new Date(now - BACK_DAYS * 86_400_000),
        new Date(now + AHEAD_DAYS * 86_400_000)
      )
    }
    const [link] = await db
      .select({
        googleEmail: calendarLinks.googleEmail,
        scopes: calendarLinks.scopes,
        syncedAt: calendarLinks.syncedAt,
        syncError: calendarLinks.syncError,
      })
      .from(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
    const sources = await db
      .select()
      .from(calendarSources)
      .where(eq(calendarSources.userId, actor.userId))
      .orderBy(
        sql`${calendarSources.kind} = 'portal' desc`,
        asc(calendarSources.kind),
        sql`${calendarSources.primary} desc`,
        asc(calendarSources.label)
      )
    return {
      configured: googleCalendarConfigured(),
      google: link
        ? {
            email: link.googleEmail,
            canList: link.scopes.split(" ").includes(LIST_SCOPE),
            syncedAt: link.syncedAt?.toISOString() ?? null,
            syncError: link.syncError,
          }
        : null,
      sources: sources.map((source) => ({
        id: source.id,
        kind: source.kind as SourceKind,
        label: source.label,
        primary: source.primary,
        busyOnly: source.accessRole === "freeBusyReader",
        canPublish: source.kind !== "google" || source.accessRole === "owner",
        host: source.url
          ? (() => {
              try {
                return new URL(open(source.url!)).host
              } catch {
                return null
              }
            })()
          : null,
        enabled: source.enabled,
        visibility: source.visibility as Visibility,
        syncedAt: source.syncedAt?.toISOString() ?? null,
        syncError: source.syncError,
      })),
    }
  },
})

async function ownSource(userId: string, id: string) {
  const [source] = await db
    .select()
    .from(calendarSources)
    .where(and(eq(calendarSources.id, id), eq(calendarSources.userId, userId)))
  if (!source) throw new Error("找不到這個行事曆")
  return source
}

export const setCalendarSource = defineAction({
  name: "set_calendar_source",
  title: "設定行事曆來源",
  description:
    "Changes one source of the signed-in member's calendar (ids from get_my_calendar): enabled turns it on or off (off removes its events from the portal), visibility sets what others see (private: busy blocks only; public: also each event's title and location; events marked private in the source stay busy blocks either way) and label renames it. Only a Google calendar the member owns may be public (one others share with them stays busy blocks). Confirm with the member before making a source public.",
  kind: "mutation",
  input: z.object({
    source_id: z.uuid(),
    enabled: z.boolean().optional(),
    visibility: visibility.optional(),
    label: z.string().trim().min(1).max(100).optional(),
  }),
  run: async (actor, input) => {
    const source = await ownSource(actor.userId, input.source_id)
    // A Google calendar someone else owns and shares with the member is
    // theirs to publish, not the member's.
    if (
      input.visibility === "public" &&
      source.kind === "google" &&
      source.accessRole !== "owner"
    )
      throw new Error("只有自己的 Google 日曆可以公開標題")
    const [updated] = await db
      .update(calendarSources)
      .set({
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(input.label ? { label: input.label } : {}),
      })
      .where(eq(calendarSources.id, source.id))
      .returning()
    if (input.enabled === false)
      await db
        .delete(calendarEvents)
        .where(eq(calendarEvents.sourceId, source.id))
    if (input.enabled && !source.enabled && syncReady())
      await syncOne(actor.userId, source.id)
    return {
      id: updated.id,
      enabled: updated.enabled,
      visibility: updated.visibility as Visibility,
      label: updated.label,
    }
  },
})

export const addCalendarSource = defineAction({
  name: "add_calendar_source",
  title: "加入行事曆",
  description:
    "Adds a calendar to the signed-in member's portal calendar: url is an ICS address (https or webcal, for example Outlook's published calendar or an iCloud public link), re-read every 5 minutes; content is the text of an .ics file, imported once. Give exactly one. label names it; visibility defaults to private (others see busy blocks only). Fails when the calendar cannot be read. Returns the source id and how many events it holds in the synced window.",
  kind: "mutation",
  input: z
    .object({
      label: z.string().trim().min(1).max(100),
      url: z.string().max(2000).optional(),
      content: z.string().max(ICS_MAX_BYTES).optional(),
      visibility: visibility.default("private"),
    })
    .refine((input) => !input.url !== !input.content, "網址和檔案要給一個"),
  run: async (actor, input) => {
    if (!syncReady()) throw new Error("行事曆沒有設定 CALENDAR_SECRET")
    const [{ total }] = await db
      .select({ total: count() })
      .from(calendarSources)
      .where(
        and(
          eq(calendarSources.userId, actor.userId),
          inArray(calendarSources.kind, ["ics", "file"])
        )
      )
    if (total >= MAX_SOURCES)
      throw new Error(`最多加入 ${MAX_SOURCES} 個行事曆`)
    const now = new Date()
    const from = new Date(now.getTime() - BACK_DAYS * 86_400_000)
    const to = new Date(now.getTime() + AHEAD_DAYS * 86_400_000)
    // Read it once first, so a wrong address or file fails here.
    const address = input.url ? icsAddress(input.url) : null
    const events = icsEvents(
      address ? await fetchIcs(address) : input.content!,
      from,
      to
    )
    const id = await db.transaction(async (tx) => {
      const [source] = await tx
        .insert(calendarSources)
        .values({
          userId: actor.userId,
          kind: address ? "ics" : "file",
          label: input.label,
          url: address ? seal(address) : null,
          content: address ? null : input.content!,
          enabled: true,
          visibility: input.visibility,
          syncedAt: now,
        })
        .returning({ id: calendarSources.id })
      if (events.length > 0)
        await tx
          .insert(calendarEvents)
          .values(
            events.map((event) => ({
              ...event,
              userId: actor.userId,
              sourceId: source.id,
            }))
          )
          .onConflictDoNothing()
      return source.id
    })
    return { id, events: events.length }
  },
})

export const removeCalendarSource = defineAction({
  name: "remove_calendar_source",
  title: "移除行事曆",
  description:
    "Removes an ICS address or imported file from the signed-in member's calendar, with its events. A Google calendar or WinLab 會議 cannot be removed: turn it off with set_calendar_source (or unlink Google with unlink_google_calendar).",
  kind: "mutation",
  input: z.object({ source_id: z.uuid() }),
  run: async (actor, input) => {
    const source = await ownSource(actor.userId, input.source_id)
    if (source.kind === "google")
      throw new Error("Google 日曆用開關關閉，或取消連結 Google")
    if (source.kind === "portal") throw new Error("WinLab 會議用開關關閉")
    await db.delete(calendarSources).where(eq(calendarSources.id, source.id))
    return { removed: true }
  },
})

export const unlinkGoogleCalendar = defineAction({
  name: "unlink_google_calendar",
  title: "取消連結 Google",
  description:
    "Unlinks the signed-in member's Google account: tells Google to drop the portal's access and deletes its calendars and their copied events. ICS addresses and files stay.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    const [removed] = await db
      .delete(calendarLinks)
      .where(eq(calendarLinks.userId, actor.userId))
      .returning({ refreshToken: calendarLinks.refreshToken })
    if (!removed) throw new Error("還沒有連結 Google 行事曆")
    await db
      .delete(calendarSources)
      .where(
        and(
          eq(calendarSources.userId, actor.userId),
          eq(calendarSources.kind, "google")
        )
      )
    try {
      await revoke(open(removed.refreshToken))
    } catch {
      // The link is gone either way; Google drops unused grants on its own.
    }
    return { unlinked: true }
  },
})

/** private, public, or mixed when the member's sources differ. */
function overall(values: string[]) {
  const set = new Set(values)
  return set.size === 1 ? (values[0] as Visibility) : ("mixed" as const)
}

export const listCalendars = defineAction({
  name: "list_calendars",
  title: "行事曆列表",
  description:
    "Members who keep a calendar on the portal, with each one's visibility (private, public, or mixed when some of their calendars are public), when it last synced, whether they are busy right now, and bookable when they take appointments (list_appointment_slots). Open one with get_member_calendar.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const now = new Date()
    const [sources, current] = await Promise.all([
      db
        .select({
          userId: calendarSources.userId,
          name: user.name,
          visibility: calendarSources.visibility,
          syncedAt: calendarSources.syncedAt,
          bookable: sql<boolean>`${appointmentSchedules.userId} is not null`,
        })
        .from(calendarSources)
        .innerJoin(user, eq(user.id, calendarSources.userId))
        .leftJoin(
          appointmentSchedules,
          eq(appointmentSchedules.userId, calendarSources.userId)
        )
        .where(eq(calendarSources.enabled, true))
        .orderBy(asc(user.name)),
      db
        .selectDistinct({ userId: calendarEvents.userId })
        .from(calendarEvents)
        .innerJoin(
          calendarSources,
          and(
            eq(calendarSources.id, calendarEvents.sourceId),
            eq(calendarSources.enabled, true)
          )
        )
        .where(
          and(lt(calendarEvents.startsAt, now), gt(calendarEvents.endsAt, now))
        ),
    ])
    const busy = new Set(current.map((row) => row.userId))
    const members = new Map<string, (typeof sources)[number][]>()
    for (const source of sources)
      members.set(source.userId, [
        ...(members.get(source.userId) ?? []),
        source,
      ])
    return {
      calendars: [...members.values()].map((rows) => {
        const times = rows.map((row) => row.syncedAt?.getTime() ?? 0)
        const oldest = Math.min(...times)
        return {
          userId: rows[0].userId,
          name: rows[0].name,
          visibility: overall(rows.map((row) => row.visibility)),
          syncedAt: oldest ? new Date(oldest).toISOString() : null,
          bookable: rows[0].bookable,
          busyNow: busy.has(rows[0].userId),
        }
      }),
    }
  },
})

async function ownerOf(userId: string) {
  const [owner] = await db
    .select({ userId: user.id, name: user.name })
    .from(user)
    .where(eq(user.id, userId))
  const visibilities = await db
    .select({ visibility: calendarSources.visibility })
    .from(calendarSources)
    .where(
      and(eq(calendarSources.userId, userId), eq(calendarSources.enabled, true))
    )
  if (!owner || visibilities.length === 0) return null
  return {
    ...owner,
    visibility: overall(visibilities.map((row) => row.visibility)),
  }
}

export const getMemberCalendar = defineAction({
  name: "get_member_calendar",
  title: "查看行事曆",
  description:
    "One member's calendar for `days` days from `from` (YYYY-MM-DD in Taipei, default today): each event's start and end (ISO), allDay, and title and location when the event's source is public (else title is the literal 忙碌 (busy) and busyOnly is true). busyUntil is when the event they are in right now ends (null when free now, or when from is not today). Also the subscription link (ICS) the signed-in member can add to their own calendar app; it is theirs alone, so never share it.",
  kind: "query",
  input: z.object({
    user_id: z.uuid(),
    from: z.string().refine(isCalendarDay, "日期要是 YYYY-MM-DD").optional(),
    days: z.number().int().min(1).max(31).default(7),
  }),
  run: async (actor, input) => {
    const owner = await ownerOf(input.user_id)
    if (!owner) throw new Error("這位成員沒有行事曆")
    const state = await calendarState(owner.userId)
    const from = input.from ?? todayInTaipei()
    const start = new Date(`${from}T00:00:00+08:00`)
    const end = new Date(`${addDays(from, input.days)}T00:00:00+08:00`)
    const rows = withoutCopies(await eventsOf(owner.userId, start, end))
    const now = Date.now()
    const current = rows.find(
      (row) =>
        !row.allDay &&
        row.startsAt.getTime() <= now &&
        row.endsAt.getTime() > now
    )
    return {
      userId: owner.userId,
      busyUntil: current?.endsAt.toISOString() ?? null,
      name: owner.name,
      visibility: owner.visibility,
      syncedAt: state.syncedAt?.toISOString() ?? null,
      syncError: actor.userId === owner.userId ? state.syncError : null,
      from,
      days: input.days,
      events: rows.map((row) => shown(row, actor.userId)),
      feedUrl: feedUrl(
        actor.userId,
        await feedVersion(actor.userId),
        owner.userId
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
  `${createHash("sha256").update(`${row.sourceId}:${row.googleId}`).digest("hex").slice(0, 32)}@portal.winlab.tw`

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
  const owner = await ownerOf(ownerId)
  if (!owner) return null
  const rows = withoutCopies(await eventsOf(ownerId))
  const stamp = icsTime(new Date().toISOString())
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WinLab//portal.winlab.tw//ZH-TW",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(`${owner.name}（WinLab）`)}`,
    "X-WR-TIMEZONE:Asia/Taipei",
    "REFRESH-INTERVAL;VALUE=DURATION:PT15M",
    "X-PUBLISHED-TTL:PT15M",
    ...rows.flatMap((row) => {
      const event = shown(row, viewerId)
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
