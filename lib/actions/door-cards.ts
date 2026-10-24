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
// One lock covers every reader call and the row writes after it, so two
// admins (or the daily check) never interleave. A failure the bridge does
// not prove harmless leaves the row marked: unknown after an add or a
// rename, deleting after a delete, which the next comparison settles.

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
  not_configured: "卡機服務沒有設定",
  unauthorized: "卡機服務的金鑰不對",
  validation: "卡號或名字不合卡機的格式",
  exists: "卡機已經有這張卡，請按「與卡機比對」",
  not_found: "卡機上沒有這張卡",
  controller_unreachable: "連不上卡機",
  controller_busy: "卡機忙碌中，20 秒後再試",
  table_suspect: "卡機的卡表疑似損毀，要用原廠 HAMS 重新上傳",
  verify_failed: "卡機沒有套用這次變更",
  verify_inconclusive: "卡機讀不出卡表，沒有寫入，20 秒後再試",
  rename_lost_card:
    "改名時卡機刪了舊卡卻沒加回，這張卡現在刷不進門，請重新加入",
  unknown: "卡機服務出錯",
}
const UNSURE = "卡機沒有確認結果，請按「與卡機比對」"
const UNSURE_DELETE =
  "卡機沒有確認刪除，這張卡可能還刷得進門，請按「與卡機比對」"
const AHEAD = "卡機已經改了，名單沒存成，請按「與卡機比對」"

const message = (error: unknown) =>
  error instanceof HamsError
    ? (MESSAGES[error.code] ?? MESSAGES.unknown)
    : error instanceof Error
      ? error.message
      : "失敗了"

/** Whether the bridge proved that a failed write changed nothing on the
 * reader. Anything else (busy, unreachable, a lost answer) may have
 * landed. */
function untouched(error: unknown, write: "add" | "rename" | "delete") {
  if (!(error instanceof HamsError)) return false
  if (
    ["not_configured", "unauthorized", "validation", "table_suspect"].includes(
      error.code
    )
  )
    return true
  if (write === "add" && error.code === "exists") return true
  // An add whose duplicate check failed wrote nothing.
  return (
    write === "add" && error.code === "verify_inconclusive" && error.unconfirmed
  )
}

/** The bridge proved the card is not on the reader. */
const absent = (error: unknown) =>
  error instanceof HamsError &&
  ((error.code === "not_found" && !error.unconfirmed) ||
    error.code === "rename_lost_card")

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Takes the card lock or gives up at once: a reader call can hold it for
 * half a minute, and waiting would hold a pool connection all that time. */
async function cardLock(tx: Tx) {
  const { rows } = await tx.execute<{ ok: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtext('door_cards')) as ok`
  )
  if (!rows[0]?.ok) throw new Error("卡機正在處理別的操作，稍後再試")
}

/** Runs fn holding the card lock, then writes the attempt down. fn returns
 * the error to throw (after its row writes commit) or the detail to log.
 * When the database fails after the reader changed, says so. */
async function locked(
  action: "add" | "update" | "delete" | "import" | "compare",
  userId: string | null,
  card: string | null,
  fn: (
    tx: Tx,
    touched: () => void
  ) => Promise<
    | { error: unknown; say: string; detail?: Record<string, unknown> }
    | { detail: Record<string, unknown> }
  >
) {
  let reader = false
  let outcome: Awaited<ReturnType<typeof fn>>
  try {
    outcome = await db.transaction(async (tx) => {
      await cardLock(tx)
      return fn(tx, () => (reader = true))
    })
  } catch (error) {
    // Refused before the reader was called (lock busy, a card still being
    // deleted, no such member): written down too, as an attempt. Only our
    // own refusals keep their message; a database error's message carries
    // the query's parameters (names, notes), so it is just db_failed.
    if (!reader) {
      const refusal =
        error instanceof z.ZodError
          ? (error.issues[0]?.message ?? "invalid")
          : error instanceof Error && error.constructor === Error
            ? error.message
            : "db_failed"
      await record(action, userId, card, refusal).catch(() => {})
      throw error
    }
    await record(action, userId, card, "db_failed").catch(() => {})
    throw new Error(AHEAD)
  }
  if ("error" in outcome) {
    await record(action, userId, card, outcome.error, outcome.detail)
    throw new Error(outcome.say)
  }
  await record(action, userId, card, null, outcome.detail)
  return outcome.detail
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

/** Who a card goes to: a member (named on the reader by their name unless
 * a name is given) or a guest, named by the admin. */
async function holderOf(
  tx: Tx,
  input: { holderId?: string | null; holderName?: string }
) {
  let name = input.holderName?.trim()
  if (input.holderId) {
    const [member] = await tx
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, input.holderId))
    if (!member) throw new Error("找不到這位成員")
    name ||= member.name
  }
  return {
    holderId: input.holderId ?? null,
    holderName: holderName.parse(name ?? ""),
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
    "Adds a card to the door reader, so it opens the lab door, and to the card list. Door admins only. holderId links it to a member (find ids with list_members), whose name goes on the reader unless holderName is given; a guest card needs holderName. A new card's number shows in list_door_cards under strangers once someone swipes it at the door. Re-adding a card the reader lost (sync_state missing or unknown) restores it and keeps its holder and note unless given.",
  kind: "mutation",
  input: z.object({ cardId, ...holderInput }),
  run: async (actor, input) =>
    locked("add", actor.userId, input.cardId, async (tx, touched) => {
      const [existing] = await tx
        .select()
        .from(doorCards)
        .where(eq(doorCards.cardId, input.cardId))
      if (existing?.syncState === "synced")
        throw new Error("這張卡已經在名單上，要換人請用修改")
      if (existing?.syncState === "deleting")
        throw new Error("這張卡還沒確認刪掉，請再刪一次")
      const holder = await holderOf(tx, {
        holderId:
          input.holderId === undefined ? existing?.holderId : input.holderId,
        holderName: input.holderName ?? existing?.holderName,
      })
      const save = (syncState: string) => {
        const values = {
          ...holder,
          note:
            input.note === undefined
              ? (existing?.note ?? null)
              : input.note || null,
          syncState,
          lastSeenAt: syncState === "synced" ? new Date() : null,
          updatedAt: new Date(),
        }
        return tx
          .insert(doorCards)
          .values({ cardId: input.cardId, ...values })
          .onConflictDoUpdate({ target: doorCards.cardId, set: values })
      }
      try {
        touched()
        await addReaderCard(input.cardId, holder.holderName)
      } catch (error) {
        if (untouched(error, "add")) return { error, say: message(error) }
        await save("unknown")
        return { error, say: UNSURE }
      }
      await save("synced")
      return { detail: { restored: Boolean(existing) } }
    }),
})

export const updateDoorCard = defineAction({
  name: "update_door_card",
  admin: "door",
  title: "修改門禁卡",
  description:
    "Changes who holds a card, its name on the reader or its note. Door admins only. Give the holder the same way as add_door_card: holderId for a member (their name unless holderName is given), holderId null and holderName for a guest; without holderId the card keeps its member. Only a new name touches the reader; it renames by deleting and re-adding the card.",
  kind: "mutation",
  input: z.object({ cardId, ...holderInput }),
  run: async (actor, input) =>
    locked("update", actor.userId, input.cardId, async (tx, touched) => {
      const [card] = await tx
        .select()
        .from(doorCards)
        .where(eq(doorCards.cardId, input.cardId))
      if (!card) throw new Error("名單上沒有這張卡")
      if (card.syncState === "deleting")
        throw new Error("這張卡還沒確認刪掉，請再刪一次")
      // Without holderId the card keeps its member.
      const holder = await holderOf(tx, {
        holderId: input.holderId === undefined ? card.holderId : input.holderId,
        holderName: input.holderName,
      })
      const renamed = holder.holderName !== card.holderName
      const handedOver =
        holder.holderId !== card.holderId ||
        (holder.holderId === null && renamed)
      // The holder is saved whatever the reader did, so re-adding a lost
      // card puts it back under the new name.
      const save = (syncState?: string) =>
        tx
          .update(doorCards)
          .set({
            ...holder,
            note: input.note === undefined ? card.note : input.note || null,
            ...(syncState
              ? {
                  syncState,
                  ...(syncState === "synced" ? { lastSeenAt: new Date() } : {}),
                }
              : {}),
            // Swipes before this belong to the previous holder.
            ...(handedOver ? { updatedAt: new Date() } : {}),
          })
          .where(eq(doorCards.cardId, input.cardId))
      if (renamed) {
        try {
          touched()
          await renameReaderCard(input.cardId, holder.holderName)
        } catch (error) {
          if (absent(error)) {
            await save("missing")
            return { error, say: message(error) }
          }
          if (untouched(error, "rename")) return { error, say: message(error) }
          await save("unknown")
          return { error, say: UNSURE }
        }
      }
      await save(renamed ? "synced" : undefined)
      return { detail: { renamed, handed_over: handedOver } }
    }),
})

export const deleteDoorCard = defineAction({
  name: "delete_door_card",
  admin: "door",
  title: "刪除門禁卡",
  description:
    "Removes a card from the door reader, so it no longer opens the lab door, and from the card list. Door admins only. A card the reader already lacks is just dropped from the list. When the reader does not confirm, the card stays listed as deleting until a comparison finds it gone; delete it again to retry.",
  kind: "mutation",
  input: z.object({ cardId }),
  run: async (actor, { cardId: card }) =>
    locked("delete", actor.userId, card, async (tx, touched) => {
      let gone = false
      try {
        touched()
        await deleteReaderCard(card)
      } catch (error) {
        gone = absent(error)
        if (!gone) {
          if (untouched(error, "delete")) return { error, say: message(error) }
          await tx
            .update(doorCards)
            .set({ syncState: "deleting" })
            .where(eq(doorCards.cardId, card))
          return { error, say: UNSURE_DELETE }
        }
      }
      await tx.delete(doorCards).where(eq(doorCards.cardId, card))
      return { detail: { already_gone: gone } }
    }),
})

/** Compares the list with the reader: marks each card synced or missing,
 * and drops the ones being deleted that the reader no longer has. Run by a
 * door admin or, with userId null, by the daily check. */
export async function compareCards(userId: string | null) {
  return traced("door cards compare", {}, async () => {
    let result: {
      readerCount: number
      suspect: boolean
      partial: boolean
      listed: number
      synced: number
      missing: string[]
      deleting: string[]
      extra: { cardId: string; name: string }[]
    }
    try {
      result = await db.transaction(async (tx) => {
        await cardLock(tx)
        const reader = await readerCards()
        const rows = await tx
          .select({ cardId: doorCards.cardId, syncState: doorCards.syncState })
          .from(doorCards)
        const onReader = new Set(reader.cards.map((card) => card.card_id))
        const listed = new Set(rows.map((row) => row.cardId))
        const kept = rows.filter((row) => row.syncState !== "deleting")
        const synced = kept.filter((row) => onReader.has(row.cardId))
        const missing = kept.filter((row) => !onReader.has(row.cardId))
        const deleting = rows.filter((row) => row.syncState === "deleting")
        const deleted = deleting.filter((row) => !onReader.has(row.cardId))
        const extra = reader.cards.filter((card) => !listed.has(card.card_id))
        const suspect = reader.count > SUSPECT_COUNT
        // The reader can claim more cards than it managed to list; then a
        // card left out of the listing proves nothing.
        const partial = reader.cards.length !== reader.count
        const ids = (list: { cardId: string }[]) => list.map((r) => r.cardId)
        // A damaged table says nothing about which cards are there.
        if (!suspect) {
          if (synced.length > 0)
            await tx
              .update(doorCards)
              .set({ syncState: "synced", lastSeenAt: new Date() })
              .where(inArray(doorCards.cardId, ids(synced)))
          if (missing.length > 0 && !partial)
            await tx
              .update(doorCards)
              .set({ syncState: "missing" })
              .where(inArray(doorCards.cardId, ids(missing)))
          if (deleted.length > 0 && !partial)
            await tx
              .delete(doorCards)
              .where(inArray(doorCards.cardId, ids(deleted)))
        }
        return {
          readerCount: reader.count,
          suspect,
          partial,
          listed: reader.cards.length,
          synced: synced.length,
          missing: ids(missing),
          deleting: ids(
            suspect || partial
              ? deleting
              : deleting.filter((r) => onReader.has(r.cardId))
          ),
          extra: extra.map((card) => ({
            cardId: card.card_id,
            name: card.name,
          })),
        }
      })
    } catch (error) {
      await record("compare", userId, null, error)
      throw new Error(message(error))
    }
    const drifted =
      result.suspect ||
      result.missing.length + result.deleting.length + result.extra.length > 0
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
    "Reads the door reader's card table and compares it with the card list: marks each listed card synced or missing, and returns the reader's cards the list lacks (extra). suspect means the reader claims an impossible count (table damage); then nothing is marked. partial means the reader listed fewer cards than it counts; then no card is marked missing or confirmed deleted, and missing and deleting are only the cards it left out. Door admins only. Also runs by itself every morning.",
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
  run: async (actor) =>
    locked("import", actor.userId, null, async (tx) => {
      let reader: Awaited<ReturnType<typeof readerCards>>
      try {
        reader = await readerCards()
      } catch (error) {
        return { error, say: message(error) }
      }
      if (reader.count > SUSPECT_COUNT)
        return { error: "table_suspect", say: MESSAGES.table_suspect }
      const cards = reader.cards.filter((card) =>
        /^[0-9]{10}$/.test(card.card_id)
      )
      const added =
        cards.length === 0
          ? []
          : await tx
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
      return { detail: { added: added.map((row) => row.cardId) } }
    }).then((detail) => ({ added: (detail.added as string[]).length })),
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
    "The cards the door reader lets in, for door admins only: the 10-digit card number, the holder name stored on the reader, the member it belongs to (null for a guest card), a note, and whether it matched the reader at the last comparison (sync_state: synced, missing from the reader, unknown after an unconfirmed write, or deleting after an unconfirmed delete, which delete_door_card retries). strangers are cards swiped at the door in the last 14 days that are on no list, newest first: how a new card's number is found. lastCompare is the latest comparison with the reader.",
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
