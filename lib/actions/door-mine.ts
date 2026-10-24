import { and, asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { apiKeys, doorCards, doorEvents } from "@/lib/db/schema"

// What every member may see of the door about themselves: the cards that
// are theirs and the openings under their name. Adding, removing and
// comparing cards stay with door admins (door-cards.ts).

/** A card number with all but its last 4 digits hidden. */
const masked = (cardId: string) => `******${cardId.slice(-4)}`

export const listMyDoorCards = defineAction({
  name: "list_my_door_cards",
  title: "我的門禁卡",
  description:
    "The signed-in member's own door cards: the number with only its last 4 digits shown, the name on the reader, a note, when it was added, and whether it matched the reader at the last comparison (sync_state: synced, missing from the reader, unknown after an unconfirmed write, or deleting). Empty when no card is registered to them; a door admin adds cards.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const rows = await db
      .select({
        cardId: doorCards.cardId,
        holderName: doorCards.holderName,
        note: doorCards.note,
        syncState: doorCards.syncState,
        createdAt: doorCards.createdAt,
      })
      .from(doorCards)
      .where(eq(doorCards.holderId, actor.userId))
      .orderBy(asc(doorCards.createdAt))
    return {
      cards: rows.map(({ cardId, ...card }) => ({
        ...card,
        card: masked(cardId),
      })),
    }
  },
})

export const listMyDoorEvents = defineAction({
  name: "list_my_door_events",
  title: "我的開門紀錄",
  description:
    "The signed-in member's own door openings, newest first: presses on /door (web), by an agent (mcp), with one of their API keys (api, with the key's name) and swipes of their card (card, with its last 4 digits). ok is null for reader events that are neither a grant nor a known denial. Page back with before set to the id of the last event returned.",
  kind: "query",
  input: z.object({
    limit: z.number().int().min(1).max(200).default(100),
    before: z.uuid("before 是事件的 id").optional(),
  }),
  run: async (actor, { limit, before }) => {
    const rows = await db
      .select({
        id: doorEvents.id,
        at: doorEvents.at,
        source: doorEvents.source,
        ok: doorEvents.ok,
        error: doorEvents.error,
        cardId: doorEvents.cardId,
        eventCode: doorEvents.eventCode,
        key: apiKeys.name,
      })
      .from(doorEvents)
      .leftJoin(apiKeys, eq(apiKeys.id, doorEvents.tokenId))
      .where(
        and(
          eq(doorEvents.userId, actor.userId),
          before
            ? sql`(${doorEvents.at}, ${doorEvents.id}) < (select at, id from door_events where id = ${before} and user_id = ${actor.userId})`
            : undefined
        )
      )
      .orderBy(desc(doorEvents.at), desc(doorEvents.id))
      .limit(limit)
    return {
      events: rows.map(({ cardId, ...event }) => ({
        ...event,
        source: event.source as "web" | "mcp" | "api" | "card",
        card: cardId ? masked(cardId) : null,
      })),
    }
  },
})

export type MyDoorEvent = Awaited<
  ReturnType<(typeof listMyDoorEvents)["run"]>
>["events"][number]
