import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { announceChange } from "@/lib/actions/changes"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { doorCards, doorEvents, user } from "@/lib/db/schema"
import { greet } from "@/lib/display"
import { doorConfigured, doorState, pulseDoor } from "@/lib/door"
import { traced } from "@/lib/otel"

export const getDoorStatus = defineAction({
  name: "get_door_status",
  title: "門禁狀態",
  description:
    "Whether the lab door relay is configured and answering, so open_door can work. Any member.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    if (!doorConfigured()) return { configured: false, online: false }
    const online = await doorState().then(
      () => true,
      () => false
    )
    return { configured: true, online }
  },
})

export const openDoor = defineAction({
  name: "open_door",
  title: "開門",
  description:
    "Unlocks the lab door (EC 4F) for a few seconds, as the member pressing /door. It physically opens the door: call it only when the member asks to open it now. Any member; every attempt is logged under their name. A failure does not prove the door stayed shut.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    const [member] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, actor.userId))
    const name = member?.name ?? "成員"
    const started = performance.now()
    let error: string | null = null
    try {
      await pulseDoor()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "門禁沒有回應"
    }
    await db.insert(doorEvents).values({
      source: actor.via,
      userId: actor.userId,
      name,
      ok: error === null,
      error,
      latencyMs: Math.round(performance.now() - started),
      tokenId: actor.tokenId,
      ip: actor.ip,
    })
    // The relay may have fired even when its answer was lost, so a failure
    // never claims the door stayed shut.
    if (error) throw new Error(`開門的請求失敗（${error}），門不一定有開`)
    void greet(name)
    return { opened: true }
  },
})

const source = z.enum(["web", "mcp", "api", "card"])

export type DoorEvent = {
  id: string
  at: Date
  source: "web" | "mcp" | "api" | "card"
  userId: string | null
  name: string
  ok: boolean | null
  error: string | null
  latencyMs: number | null
  cardId: string | null
  eventCode: string | null
}

export const listDoorEvents = defineAction({
  name: "list_door_events",
  admin: "door",
  title: "開門紀錄",
  description:
    "Door openings, newest first, for door admins only: presses on /door (web), presses by an agent (mcp), calls to POST /api/door/open with a member's door token (api) and card swipes (card, timed by the reader's clock). ok is null for reader events that are neither a grant nor a known denial. Page back with before set to the id of the last event returned.",
  kind: "query",
  input: z.object({
    limit: z.number().int().min(1).max(500).default(100),
    before: z.uuid("before 是事件的 id").optional(),
    source: source.optional(),
  }),
  run: async (actor, { limit, before, source }) => {
    const rows = await db
      .select({
        id: doorEvents.id,
        at: doorEvents.at,
        source: doorEvents.source,
        userId: doorEvents.userId,
        name: doorEvents.name,
        ok: doorEvents.ok,
        error: doorEvents.error,
        latencyMs: doorEvents.latencyMs,
        cardId: doorEvents.cardId,
        eventCode: doorEvents.eventCode,
      })
      .from(doorEvents)
      .where(
        and(
          // Older than the event given; the id breaks ties in time.
          before
            ? sql`(${doorEvents.at}, ${doorEvents.id}) < (select at, id from door_events where id = ${before})`
            : undefined,
          source ? eq(doorEvents.source, source) : undefined
        )
      )
      .orderBy(desc(doorEvents.at), desc(doorEvents.id))
      .limit(limit)
    return { events: rows as DoorEvent[] }
  },
})

export const listDoorCards = defineAction({
  name: "list_door_cards",
  admin: "door",
  title: "門禁卡",
  description:
    "The cards the door reader lets in, for door admins only: the 10-digit card number, the holder name stored on the reader, the member it belongs to (null for a guest card), a note, and whether it matched the reader at the last comparison (sync_state).",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const cards = await db
      .select({
        cardId: doorCards.cardId,
        holderName: doorCards.holderName,
        holderId: doorCards.holderId,
        member: user.name,
        note: doorCards.note,
        syncState: doorCards.syncState,
        lastSeenAt: doorCards.lastSeenAt,
      })
      .from(doorCards)
      .leftJoin(user, eq(user.id, doorCards.holderId))
      .orderBy(asc(doorCards.holderName), asc(doorCards.cardId))
    return { cards }
  },
})

// Card swipes reported by hams-bridge. Not an action: the bridge is a
// machine with its own secret (app/api/door/events), not a member.

// A real calendar time: Date rolls 02-31 over into March, so the parsed
// time must print back as the same wall clock.
const sameWallClock = (value: string, offsetHours: number) => {
  const time = Date.parse(value)
  return (
    !Number.isNaN(time) &&
    new Date(time + offsetHours * 3600_000).toISOString().slice(0, 19) ===
      value.slice(0, 19)
  )
}
const deviceTime = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
  .refine((value) => sameWallClock(value, 8))
const utcTime = z
  .string()
  .regex(/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/)
  .refine((value) => sameWallClock(value, 0))

export const cardSwipes = z.object({
  events: z
    .array(
      z.object({
        event_id: z.string().regex(/^[0-9a-f]{64}$/),
        card_id: z.string().regex(/^[0-9]{10}$/),
        device_time: deviceTime,
        event_code: z.string().regex(/^[0-9A-F]{4}$/),
        reader: z.union([z.literal(1), z.literal(2)]),
        received_at: utcTime,
      })
    )
    .min(1)
    .max(100)
    .refine(
      (events) =>
        new Set(events.map((event) => event.event_id)).size === events.length,
      "duplicate event_id"
    ),
})

const GRANTED = new Set(["0000", "0009", "003D", "003F"])
const DENIED: Record<string, string> = {
  "0006": "黑名單",
  "0008": "指紋比對失敗",
  "0014": "無此卡號",
  "0015": "權限不符",
  "0020": "無開門權限",
  "0022": "保全中",
  "003E": "密碼錯誤",
  "0043": "防反潛回限制",
}
// A swipe is greeted only when the bridge just read it and it arrives alone
// (or in a pair); a bigger batch is the bridge catching up, not people at
// the door. The bridge's clock decides: the reader's drifts by minutes.
const GREET_WITHIN_MS = 2 * 60_000
const GREET_MAX_BATCH = 2

/** Stores the swipes the bridge sent (each once), greets fresh grants at the
 * door, and returns the event ids accepted. */
export async function recordCardSwipes(
  events: z.infer<typeof cardSwipes>["events"]
) {
  return traced(
    "door card swipes",
    { "door.events": events.length },
    async () => {
      const holders = await db
        .select({
          cardId: doorCards.cardId,
          holderName: doorCards.holderName,
          holderId: doorCards.holderId,
          member: user.name,
          updatedAt: doorCards.updatedAt,
        })
        .from(doorCards)
        .leftJoin(user, eq(user.id, doorCards.holderId))
        .where(
          inArray(doorCards.cardId, [...new Set(events.map((e) => e.card_id))])
        )
      const byCard = new Map(holders.map((holder) => [holder.cardId, holder]))
      const rows = events.map((event) => {
        const at = new Date(event.device_time)
        // Today's holder is no proof of who held the card before it was
        // assigned, so older swipes stay anonymous.
        const holder = byCard.get(event.card_id)
        const known = holder && at >= holder.updatedAt ? holder : undefined
        const granted = GRANTED.has(event.event_code)
        const denial = DENIED[event.event_code]
        return {
          source: "card" as const,
          sourceEventId: event.event_id,
          cardId: event.card_id,
          eventCode: event.event_code,
          reader: event.reader,
          at,
          receivedAt: new Date(event.received_at),
          userId: known?.holderId ?? null,
          name: known?.member ?? (known?.holderName || "卡片"),
          ok: granted ? true : denial ? false : null,
          error: denial ?? null,
        }
      })
      const stored = await db
        .insert(doorEvents)
        .values(rows)
        .onConflictDoNothing({ target: doorEvents.sourceEventId })
        .returning({
          name: doorEvents.name,
          ok: doorEvents.ok,
          receivedAt: doorEvents.receivedAt,
        })
      if (stored.length > 0) await announceChange("card_swipe").catch(() => {})
      if (stored.length <= GREET_MAX_BATCH)
        for (const event of stored)
          if (
            event.ok &&
            event.name !== "卡片" &&
            event.receivedAt &&
            Math.abs(Date.now() - event.receivedAt.getTime()) < GREET_WITHIN_MS
          )
            void greet(event.name)
      return events.map((event) => event.event_id)
    }
  )
}
