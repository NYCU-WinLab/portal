import { eq, inArray, isNotNull, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { panelPlaylists } from "@/lib/actions/door-sounds"
import { readSchedule } from "@/lib/actions/meetings-shared"
import { db } from "@/lib/db"
import {
  doorCards,
  doorGreetings,
  doorPlaylistItems,
  doorSounds,
  leaves,
  user,
} from "@/lib/db/schema"
import { panelName, soundLink, suffixProblem } from "@/lib/door-greeting"
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
    "How the lab door greets the signed-in member: suffix (shown after their name on the LED panel, null for the default ！！) and their playlist, the pool sounds the door picks from at random (empty plays one of the lab's defaults).",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [[row], playlist] = await Promise.all([
      db
        .select({ suffix: doorGreetings.suffix })
        .from(doorGreetings)
        .where(eq(doorGreetings.userId, actor.userId)),
      db
        .select({ id: doorSounds.id, label: doorSounds.label })
        .from(doorPlaylistItems)
        .innerJoin(doorSounds, eq(doorSounds.id, doorPlaylistItems.soundId))
        .where(eq(doorPlaylistItems.userId, actor.userId))
        .orderBy(doorPlaylistItems.createdAt),
    ])
    return { suffix: row?.suffix ?? null, playlist }
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

// What the door panel reads (not actions: the panel is a machine with its
// own secret, /api/door/greetings and /api/door/meeting).

/**
 * Keyed by the name the panel shows (the member's name and the holder name
 * on each of their cards): suffix, and playlist, the pool sound ids the
 * door picks one of at random. pool links every listed sound, default
 * lists the ones for everyone else. sound is the format before playlists,
 * each member's first sound, for a panel that has not moved on yet. color
 * stays empty; per-member colors were dropped in the move.
 */
export async function panelGreetings() {
  const [suffixRows, { playlists, defaults }] = await Promise.all([
    db
      .select({ userId: doorGreetings.userId, suffix: doorGreetings.suffix })
      .from(doorGreetings)
      .where(isNotNull(doorGreetings.suffix)),
    panelPlaylists(),
  ])
  const suffixes = new Map(suffixRows.map((row) => [row.userId, row.suffix!]))
  const ids = [...new Set([...suffixes.keys(), ...playlists.keys()])].sort()
  const [members, cards] = ids.length
    ? await Promise.all([
        db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, ids)),
        db
          .select({ holderId: doorCards.holderId, name: doorCards.holderName })
          .from(doorCards)
          .where(inArray(doorCards.holderId, ids)),
      ])
    : [[], []]
  const names = new Map(members.map((member) => [member.id, member.name]))
  const suffix: Record<string, string> = {}
  const playlist: Record<string, string[]> = {}
  const sound: Record<string, { url: string; mode: string; version: string }> =
    {}
  const pool: Record<string, { url: string; version: string }> = {}
  const link = (soundId: string) =>
    (pool[soundId] ??= { url: soundLink(soundId), version: soundId })
  for (const userId of ids) {
    const name = names.get(userId)
    if (name === undefined) continue
    const labels = [
      name,
      ...cards.filter((c) => c.holderId === userId).map((c) => c.name),
    ].map(panelName)
    const own = suffixes.get(userId)
    const list = playlists.get(userId) ?? []
    for (const label of labels) {
      // The first member to claim a name keeps it.
      if (!label) continue
      if (own && !(label in suffix)) suffix[label] = own
      if (list.length && !(label in playlist)) {
        playlist[label] = list
        list.forEach(link)
        sound[label] = { ...pool[list[0]], mode: "sound_only" }
      }
    }
  }
  for (const soundId of defaults) link(soundId)
  return { suffix, color: {}, sound, playlist, pool, default: defaults }
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
