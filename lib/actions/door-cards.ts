import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import { announceChange } from "@/lib/actions/changes"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { doorCardChanges, doorCards, doorEvents, user } from "@/lib/db/schema"
import {
  addReaderCard,
  deleteReaderCard,
  HamsError,
  readerCards,
  renameReaderCard,
} from "@/lib/hams"
import { emitErrorLog, traced } from "@/lib/otel"

// Card management: the reader at the door keeps its own card table, and
// these actions change it through hams-bridge first and write door_cards
// only after, so the list never claims a card the reader does not hold.
// When the bridge cannot confirm a write, the row is marked unknown and the
// admin is told to compare.

const cardId = z.string().regex(/^[0-9]{10}$/, "卡號是 10 位數字")

// The reader stores names in Big5, 16 bytes: 8 Chinese characters. This
// counts the same way; the bridge does the real encoding.
const big5Bytes = (value: string) =>
  [...value].reduce((n, char) => n + (char.charCodeAt(0) < 128 ? 1 : 2), 0)
const holderName = z
  .string()
  .trim()
  .min(1, "請填持卡人名字")
  .refine((value) => big5Bytes(value) <= 16, "名字太長：卡機最多 8 個中文字")

/** The reader holds a few dozen cards; a count past this is the table
 * damage of 2026-09-21 (10,240 claimed, 16 real), and nothing it lists can
 * be trusted. */
const SUSPECT_COUNT = 200

const MESSAGES: Record<string, string> = {
  unauthorized: "卡機服務的金鑰不對",
  validation: "卡號或名字不合卡機的格式",
  exists: "卡機已經有這張卡，請按「與卡機比對」後匯入",
  not_found: "卡機上沒有這張卡",
  controller_unreachable: "連不上卡機",
  controller_busy: "卡機忙碌中，20 秒後再試",
  table_suspect: "卡機的卡表疑似損毀，要用原廠 HAMS 重新上傳",
  verify_failed: "卡機沒有套用這次變更",
  verify_inconclusive: "卡機沒有回報結果",
  rename_lost_card:
    "改名時卡機刪了舊卡卻沒加回，這張卡現在刷不進門，請重新新增",
  unknown: "卡機服務出錯",
}
const UNSURE = "卡機沒有回報結果，請按「與卡機比對」確認"

const message = (error: unknown) =>
  error instanceof HamsError
    ? (MESSAGES[error.code] ?? MESSAGES.unknown)
    : error instanceof Error
      ? error.message
      : "失敗了"

/** Whether a failed write may still have reached the reader. */
function mayHaveLanded(error: unknown, write: "add" | "rename" | "delete") {
  if (!(error instanceof HamsError)) return false
  if (error.code === "controller_unreachable") return error.unconfirmed
  if (error.code === "verify_inconclusive")
    // An add whose duplicate check failed wrote nothing.
    return !(write === "add" && error.unconfirmed)
  if (error.code === "not_found") return write === "delete" && error.unconfirmed
  return false
}

/** Writes the attempt down. error: null when it worked, a string for a
 * drift found, or what was thrown; a failed read has no detail. */
async function record(
  action: "add" | "update" | "delete" | "import" | "compare",
  userId: string | null,
  card: string | null,
  error: unknown,
  detail?: Record<string, unknown>
) {
  await db.insert(doorCardChanges).values({
    action,
    cardId: card,
    userId,
    ok: error === null,
    error:
      error === null || typeof error === "string"
        ? error
        : error instanceof HamsError
          ? error.code
          : message(error),
    detail: detail ?? null,
  })
}

async function memberName(id: string) {
  const [member] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, id))
  if (!member) throw new Error("找不到這位成員")
  return member.name
}

/** Who a card goes to: a member (named on the reader by their name unless
 * a name is given) or a guest, named by the admin. */
async function holderOf(input: {
  holderId?: string | null
  holderName?: string
}) {
  const name =
    input.holderName?.trim() ||
    (input.holderId ? await memberName(input.holderId) : "")
  return {
    holderId: input.holderId ?? null,
    holderName: holderName.parse(name),
  }
}

const holderInput = {
  holderId: z.uuid("holderId 是成員的 id").nullable().optional(),
  holderName: z.string().optional(),
  note: z.string().trim().max(200).optional(),
}

export const addDoorCard = defineAction({
  name: "add_door_card",
  admin: "door",
  title: "新增門禁卡",
  description:
    "Adds a card to the door reader, so it opens the lab door, and to the card list. Door admins only. holderId links it to a member (find ids with list_members), whose name goes on the reader unless holderName is given; a guest card needs holderName. A new card's number shows in list_door_cards under strangers once someone swipes it at the door. Re-adding a card the reader lost restores it.",
  kind: "mutation",
  input: z.object({ cardId, ...holderInput }),
  run: async (actor, input) => {
    const holder = await holderOf(input)
    const [existing] = await db
      .select({ syncState: doorCards.syncState })
      .from(doorCards)
      .where(eq(doorCards.cardId, input.cardId))
    if (existing?.syncState === "synced")
      throw new Error("這張卡已經在名單上，要換人請用修改")
    const save = (syncState: string) => {
      const values = {
        ...holder,
        note: input.note || null,
        syncState,
        lastSeenAt: syncState === "synced" ? new Date() : null,
        updatedAt: new Date(),
      }
      return db
        .insert(doorCards)
        .values({ cardId: input.cardId, ...values })
        .onConflictDoUpdate({ target: doorCards.cardId, set: values })
    }
    try {
      await addReaderCard(input.cardId, holder.holderName)
    } catch (error) {
      if (mayHaveLanded(error, "add")) await save("unknown")
      await record("add", actor.userId, input.cardId, error)
      if (error instanceof HamsError && error.code === "verify_inconclusive")
        throw new Error(
          mayHaveLanded(error, "add")
            ? UNSURE
            : "卡機讀不出卡表，沒有寫入，20 秒後再試"
        )
      throw new Error(mayHaveLanded(error, "add") ? UNSURE : message(error))
    }
    await save("synced")
    await record("add", actor.userId, input.cardId, null, {
      restored: Boolean(existing),
    })
    return { cardId: input.cardId, holderName: holder.holderName }
  },
})

export const updateDoorCard = defineAction({
  name: "update_door_card",
  admin: "door",
  title: "修改門禁卡",
  description:
    "Changes who holds a card, its name on the reader or its note. Door admins only. Give the holder the same way as add_door_card: holderId for a member (their name unless holderName is given), holderName alone for a guest. Only a new name touches the reader; it renames by deleting and re-adding the card.",
  kind: "mutation",
  input: z.object({ cardId, ...holderInput }),
  run: async (actor, input) => {
    const [card] = await db
      .select()
      .from(doorCards)
      .where(eq(doorCards.cardId, input.cardId))
    if (!card) throw new Error("名單上沒有這張卡")
    const holder = await holderOf(input)
    const renamed = holder.holderName !== card.holderName
    if (renamed) {
      try {
        await renameReaderCard(input.cardId, holder.holderName)
      } catch (error) {
        const lost =
          error instanceof HamsError && error.code === "rename_lost_card"
        const unsure = mayHaveLanded(error, "rename")
        if (lost || unsure)
          await db
            .update(doorCards)
            .set({ syncState: lost ? "missing" : "unknown" })
            .where(eq(doorCards.cardId, input.cardId))
        await record("update", actor.userId, input.cardId, error)
        throw new Error(unsure ? UNSURE : message(error))
      }
    }
    const handedOver =
      holder.holderId !== card.holderId || (holder.holderId === null && renamed)
    await db
      .update(doorCards)
      .set({
        ...holder,
        note: input.note === undefined ? card.note : input.note || null,
        ...(renamed ? { syncState: "synced", lastSeenAt: new Date() } : {}),
        // Swipes before this belong to the previous holder.
        ...(handedOver ? { updatedAt: new Date() } : {}),
      })
      .where(eq(doorCards.cardId, input.cardId))
    await record("update", actor.userId, input.cardId, null, {
      renamed,
      handed_over: handedOver,
    })
    return { cardId: input.cardId, holderName: holder.holderName }
  },
})

export const deleteDoorCard = defineAction({
  name: "delete_door_card",
  admin: "door",
  title: "刪除門禁卡",
  description:
    "Removes a card from the door reader, so it no longer opens the lab door, and from the card list. Door admins only. A card the reader already lacks is just dropped from the list.",
  kind: "mutation",
  input: z.object({ cardId }),
  run: async (actor, { cardId: card }) => {
    let gone = false
    try {
      await deleteReaderCard(card)
    } catch (error) {
      gone =
        error instanceof HamsError &&
        error.code === "not_found" &&
        !error.unconfirmed
      if (!gone) {
        const unsure = mayHaveLanded(error, "delete")
        if (unsure)
          await db
            .update(doorCards)
            .set({ syncState: "unknown" })
            .where(eq(doorCards.cardId, card))
        await record("delete", actor.userId, card, error)
        throw new Error(unsure ? UNSURE : message(error))
      }
    }
    await db.delete(doorCards).where(eq(doorCards.cardId, card))
    await record("delete", actor.userId, card, null, { already_gone: gone })
    return { deleted: card }
  },
})

/** Compares the list with the reader and marks each card synced or
 * missing. Run by a door admin or, with userId null, by the daily check. */
export async function compareCards(userId: string | null) {
  return traced("door cards compare", {}, async () => {
    let reader: Awaited<ReturnType<typeof readerCards>>
    try {
      reader = await readerCards()
    } catch (error) {
      await record("compare", userId, null, error)
      throw new Error(message(error))
    }
    const rows = await db.select({ cardId: doorCards.cardId }).from(doorCards)
    const onReader = new Set(reader.cards.map((card) => card.card_id))
    const listed = new Set(rows.map((row) => row.cardId))
    const synced = rows.filter((row) => onReader.has(row.cardId))
    const missing = rows.filter((row) => !onReader.has(row.cardId))
    const extra = reader.cards.filter((card) => !listed.has(card.card_id))
    const suspect = reader.count > SUSPECT_COUNT
    // A damaged table says nothing about which cards are there.
    if (!suspect) {
      if (synced.length > 0)
        await db
          .update(doorCards)
          .set({ syncState: "synced", lastSeenAt: new Date() })
          .where(
            inArray(
              doorCards.cardId,
              synced.map((row) => row.cardId)
            )
          )
      if (missing.length > 0)
        await db
          .update(doorCards)
          .set({ syncState: "missing" })
          .where(
            inArray(
              doorCards.cardId,
              missing.map((row) => row.cardId)
            )
          )
    }
    const result = {
      readerCount: reader.count,
      suspect,
      synced: synced.length,
      missing: missing.map((row) => row.cardId),
      extra: extra.map((card) => ({ cardId: card.card_id, name: card.name })),
    }
    const drifted = suspect || missing.length > 0 || extra.length > 0
    await record("compare", userId, null, drifted ? "drift" : null, result)
    await announceChange("compare_door_cards").catch(() => {})
    return result
  })
}

export const compareDoorCards = defineAction({
  name: "compare_door_cards",
  admin: "door",
  title: "與卡機比對",
  description:
    "Reads the door reader's card table and compares it with the card list: marks each listed card synced or missing, and returns the reader's cards the list lacks (extra). suspect means the reader claims an impossible count (table damage); then nothing is marked. Door admins only. Also runs by itself every morning.",
  kind: "mutation",
  input: z.object({}),
  run: (actor) => compareCards(actor.userId),
})

export const importDoorCards = defineAction({
  name: "import_door_cards",
  admin: "door",
  title: "匯入卡機的卡",
  description:
    "Adds to the card list every card the door reader holds that the list lacks, named as on the reader and linked to no member; link them with update_door_card. Writes nothing to the reader. Door admins only.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    let reader: Awaited<ReturnType<typeof readerCards>>
    try {
      reader = await readerCards()
    } catch (error) {
      await record("import", actor.userId, null, error)
      throw new Error(message(error))
    }
    if (reader.count > SUSPECT_COUNT) throw new Error(MESSAGES.table_suspect)
    const cards = reader.cards.filter((card) =>
      /^[0-9]{10}$/.test(card.card_id)
    )
    const added =
      cards.length === 0
        ? []
        : await db
            .insert(doorCards)
            .values(
              cards.map((card) => ({
                cardId: card.card_id,
                holderName: card.name || "卡片",
                syncState: "synced",
                lastSeenAt: new Date(),
              }))
            )
            .onConflictDoNothing({ target: doorCards.cardId })
            .returning({ cardId: doorCards.cardId })
    await record("import", actor.userId, null, null, {
      added: added.map((row) => row.cardId),
    })
    return { added: added.length }
  },
})

export const listDoorCardChanges = defineAction({
  name: "list_door_card_changes",
  admin: "door",
  title: "門禁卡紀錄",
  description:
    "The latest changes to the door reader's cards and comparisons with it, newest first, for door admins only: action (add, update, delete, import, compare), card, who (null for the daily check), ok, error (the bridge's code) and detail.",
  kind: "query",
  input: z.object({ limit: z.number().int().min(1).max(200).default(20) }),
  run: async (_actor, { limit }) => {
    const changes = await db
      .select({
        id: doorCardChanges.id,
        at: doorCardChanges.at,
        action: doorCardChanges.action,
        cardId: doorCardChanges.cardId,
        by: user.name,
        ok: doorCardChanges.ok,
        error: doorCardChanges.error,
        detail: doorCardChanges.detail,
      })
      .from(doorCardChanges)
      .leftJoin(user, eq(user.id, doorCardChanges.userId))
      .orderBy(desc(doorCardChanges.at))
      .limit(limit)
    return { changes }
  },
})

export const listDoorCards = defineAction({
  name: "list_door_cards",
  admin: "door",
  title: "門禁卡",
  description:
    "The cards the door reader lets in, for door admins only: the 10-digit card number, the holder name stored on the reader, the member it belongs to (null for a guest card), a note, and whether it matched the reader at the last comparison (sync_state: synced, missing from the reader, or unknown after an unconfirmed write). strangers are cards swiped at the door in the last 14 days that are on no list, newest first: how a new card's number is found. lastCompare is the latest comparison with the reader.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [cards, strangers, [lastCompare]] = await Promise.all([
      db
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
        .orderBy(asc(doorCards.holderName), asc(doorCards.cardId)),
      db
        .select({
          cardId: sql<string>`${doorEvents.cardId}`,
          at: sql<Date>`max(${doorEvents.at})`.mapWith(
            (value: string) => new Date(value)
          ),
        })
        .from(doorEvents)
        .where(
          and(
            eq(doorEvents.source, "card"),
            gte(doorEvents.at, sql`now() - interval '14 days'`),
            notExists(
              db
                .select({ one: sql`1` })
                .from(doorCards)
                .where(eq(doorCards.cardId, doorEvents.cardId))
            )
          )
        )
        .groupBy(doorEvents.cardId)
        .orderBy(desc(sql`max(${doorEvents.at})`))
        .limit(10),
      db
        .select({
          at: doorCardChanges.at,
          ok: doorCardChanges.ok,
          error: doorCardChanges.error,
          detail: doorCardChanges.detail,
        })
        .from(doorCardChanges)
        .where(eq(doorCardChanges.action, "compare"))
        .orderBy(desc(doorCardChanges.at))
        .limit(1),
    ])
    return { cards, strangers, lastCompare: lastCompare ?? null }
  },
})

const COMPARE_HOUR = 5

/** Compares the list with the reader once a day, after 05:00 Taipei, so a
 * card the reader lost shows up before anyone is left outside. */
export function startDoorCardsScheduler() {
  const tick = async () => {
    if (!process.env.HAMS_API_URL || !process.env.HAMS_API_SECRET) return
    const taipei = new Date(Date.now() + 8 * 3600_000)
    if (taipei.getUTCHours() < COMPARE_HOUR) return
    const since = new Date(
      Date.UTC(
        taipei.getUTCFullYear(),
        taipei.getUTCMonth(),
        taipei.getUTCDate(),
        COMPARE_HOUR - 8
      )
    )
    const [done] = await db
      .select({ id: doorCardChanges.id })
      .from(doorCardChanges)
      .where(
        and(
          eq(doorCardChanges.action, "compare"),
          isNull(doorCardChanges.userId),
          // A read that failed is tried again next hour.
          isNotNull(doorCardChanges.detail),
          gte(doorCardChanges.at, since)
        )
      )
      .limit(1)
    if (!done) await compareCards(null)
  }
  const run = () => void tick().catch((error) => emitErrorLog(error, {}))
  setInterval(run, 60 * 60_000).unref()
  run()
}
