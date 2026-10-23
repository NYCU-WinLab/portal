import { randomBytes } from "node:crypto"

import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { readSchedule } from "@/lib/actions/meetings-shared"
import { db } from "@/lib/db"
import { doorCards, doorGreetings, leaves, user } from "@/lib/db/schema"
import {
  SOUND_MAX_BYTES,
  panelName,
  soundLink,
  soundType,
  suffixProblem,
} from "@/lib/door-greeting"
import { taipeiToday } from "@/lib/leave-dates"

async function upsert(
  userId: string,
  values: Partial<typeof doorGreetings.$inferInsert>
) {
  await db
    .insert(doorGreetings)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: doorGreetings.userId,
      set: { ...values, updatedAt: sql`now()` },
    })
}

export const getMyDoorGreeting = defineAction({
  name: "get_my_door_greeting",
  title: "我的門口歡迎",
  description:
    "How the lab door greets the signed-in member: suffix (shown after their name on the LED panel, null for the default ！！), whether they uploaded their own sound, and whether it plays (play_sound) instead of the lab's default.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [row] = await db
      .select({
        suffix: doorGreetings.suffix,
        soundType: doorGreetings.soundType,
        playSound: doorGreetings.playSound,
      })
      .from(doorGreetings)
      .where(eq(doorGreetings.userId, actor.userId))
    return {
      suffix: row?.suffix ?? null,
      has_sound: Boolean(row?.soundType),
      play_sound: row?.playSound ?? false,
    }
  },
})

export const setDoorSuffix = defineAction({
  name: "set_door_suffix",
  title: "設定門口後綴",
  description:
    "Sets what the door's LED panel shows after the signed-in member's name, at most 3 CJK characters or 6 ASCII characters; null or an empty string goes back to the default ！！.",
  kind: "mutation",
  input: z.object({ suffix: z.string().max(64).nullable() }),
  run: async (actor, { suffix }) => {
    const value = suffix?.normalize("NFC").trim() || null
    const problem = value && suffixProblem(value)
    if (problem) throw new Error(problem)
    await upsert(actor.userId, { suffix: value })
    return { suffix: value }
  },
})

export const uploadDoorSound = defineAction({
  name: "upload_door_sound",
  title: "上傳門口音效",
  description: `Uploads the signed-in member's own door sound as base64 (mp3, m4a, aac, wav or ogg, up to ${SOUND_MAX_BYTES / 1024 / 1024} MB; the door plays its first 10 seconds) and turns it on. It replaces the previous one.`,
  kind: "mutation",
  input: z.object({ base64: z.base64("檔案要是 base64") }),
  run: async (actor, { base64 }) => {
    const sound = Buffer.from(base64, "base64")
    if (!sound.length) throw new Error("音檔是空的")
    if (sound.length > SOUND_MAX_BYTES) throw new Error("音檔超過 3 MB")
    const type = soundType(sound)
    if (!type) throw new Error("只接受 mp3、m4a、aac、wav、ogg 音檔")
    await upsert(actor.userId, {
      sound,
      soundType: type,
      soundVersion: randomBytes(8).toString("hex"),
      playSound: true,
    })
    return { uploaded: true, play_sound: true }
  },
})

export const setDoorSound = defineAction({
  name: "set_door_sound",
  title: "選擇門口音效",
  description:
    "Chooses which sound the lab door plays when the signed-in member opens it: their own uploaded sound (play_sound true; upload one with upload_door_sound first) or the lab's default (false).",
  kind: "mutation",
  input: z.object({ play_sound: z.boolean() }),
  run: async (actor, { play_sound }) => {
    if (play_sound) {
      const [row] = await db
        .select({ soundType: doorGreetings.soundType })
        .from(doorGreetings)
        .where(eq(doorGreetings.userId, actor.userId))
      if (!row?.soundType) throw new Error("還沒有上傳音效")
    }
    await upsert(actor.userId, { playSound: play_sound })
    return { play_sound }
  },
})

export const deleteDoorSound = defineAction({
  name: "delete_door_sound",
  title: "刪除門口音效",
  description:
    "Deletes the signed-in member's own door sound; the door goes back to the lab's default for them.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    await upsert(actor.userId, {
      sound: null,
      soundType: null,
      soundVersion: null,
      playSound: false,
    })
    return { deleted: true }
  },
})

// What the door panel reads (not actions: the panel is a machine with its
// own secret, /api/door/greetings and /api/door/meeting).

/**
 * {suffix, color, sound}, each keyed by the name the panel shows: the
 * member's name and the holder name on each of their cards. color stays
 * empty; per-member colors were dropped in the move.
 */
export async function panelGreetings() {
  const rows = await db
    .select({
      userId: doorGreetings.userId,
      name: user.name,
      suffix: doorGreetings.suffix,
      soundVersion: doorGreetings.soundVersion,
      playSound: doorGreetings.playSound,
    })
    .from(doorGreetings)
    .innerJoin(user, eq(user.id, doorGreetings.userId))
    .where(
      or(
        isNotNull(doorGreetings.suffix),
        and(
          eq(doorGreetings.playSound, true),
          isNotNull(doorGreetings.soundVersion)
        )
      )
    )
    .orderBy(doorGreetings.userId)
  const cards = rows.length
    ? await db
        .select({ holderId: doorCards.holderId, name: doorCards.holderName })
        .from(doorCards)
        .where(
          inArray(
            doorCards.holderId,
            rows.map((row) => row.userId)
          )
        )
    : []
  const suffix: Record<string, string> = {}
  const sound: Record<string, { url: string; mode: string; version: string }> =
    {}
  for (const row of rows) {
    const names = [
      row.name,
      ...cards.filter((c) => c.holderId === row.userId).map((c) => c.name),
    ].map(panelName)
    for (const name of names) {
      // The first member to claim a name keeps it.
      if (!name) continue
      if (row.suffix && !(name in suffix)) suffix[name] = row.suffix
      if (row.playSound && row.soundVersion && !(name in sound))
        sound[name] = {
          url: soundLink(row.userId, row.soundVersion),
          mode: "sound_only",
          version: row.soundVersion,
        }
    }
  }
  return { suffix, color: {}, sound }
}

/** A member's sound at this version, or null when it has changed since. */
export async function panelSound(userId: string, version: string) {
  const [row] = await db
    .select({ sound: doorGreetings.sound, type: doorGreetings.soundType })
    .from(doorGreetings)
    .where(
      and(
        eq(doorGreetings.userId, userId),
        eq(doorGreetings.soundVersion, version)
      )
    )
  return row?.sound && row.type ? { bytes: row.sound, type: row.type } : null
}

const kindLabel: Record<string, string> = {
  regular: "報告",
  thesis: "碩論",
  speaker: "演講",
}

/** The next lab meeting, for the panel's countdown, or null. */
export async function panelMeeting() {
  const today = taipeiToday()
  const next = (await readSchedule()).find(
    (row) => row.date >= today && row.kind !== "holiday"
  )
  if (!next) return null
  const away = await db
    .select({ name: user.name })
    .from(leaves)
    .innerJoin(user, eq(user.id, leaves.userId))
    .where(eq(leaves.date, next.date))
    .orderBy(leaves.createdAt)
  return {
    starts_at: `${next.date}T${next.startsAt}:00+08:00`,
    location: next.location ?? "",
    type_label: kindLabel[next.kind] ?? "報告",
    presenter: next.presenter ? panelName(next.presenter.name) : null,
    questioners: next.questioners.map((q) => panelName(q.name)),
    absent: away.map((row) => panelName(row.name)),
  }
}
