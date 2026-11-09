import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { doorSoundRules, doorSounds } from "@/lib/db/schema"
import { clock, taipeiWeekMinute, weekRanges } from "@/lib/door-greeting"

// The lab's door sounds by the time of day. A member's own playlist always
// wins; for a member with an empty one, the door plays one of the sounds of
// the rules in force (picked at random), and the lab's defaults when none
// is. Door admins keep the rules; every member may read them.

const RULE_SOUNDS_MAX = 50
// A plain string in the schema: a transform would make MCP clients see a
// number and turn "06:00" into one before it is sent.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間要像 22:00")
const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
const mask = (days: number[]) =>
  days.reduce((bits, day) => bits | (1 << (day - 1)), 0)
const dayList = (bits: number) =>
  [1, 2, 3, 4, 5, 6, 7].filter((day) => bits & (1 << (day - 1)))

const fields = z.object({
  starts_at: time.describe("HH:MM, Asia/Taipei."),
  ends_at: time.describe(
    "HH:MM, Asia/Taipei; at or before starts_at runs past midnight."
  ),
  days: z
    .array(z.int().min(1).max(7))
    .min(1, "至少選一天")
    .max(7)
    .default([1, 2, 3, 4, 5, 6, 7])
    .describe("Weekdays the range starts on, 1 Monday to 7 Sunday."),
  sound_ids: z
    .array(z.uuid("找不到這個音效"))
    .min(1, "至少選一個音效")
    .max(RULE_SOUNDS_MAX, `最多 ${RULE_SOUNDS_MAX} 個音效`)
    .refine((ids) => new Set(ids).size === ids.length, "有重複的音效")
    .describe("Pool sounds (ids from list_door_sounds); one plays at random."),
  enabled: z.boolean().default(true),
})

type Row = typeof doorSoundRules.$inferSelect

const inForce = (row: Row, minute: number) =>
  row.enabled &&
  weekRanges(row).some(([start, end]) => start <= minute && minute < end)

/** Checks the times and that every sound still exists. */
async function valuesOf(input: z.infer<typeof fields>, userId: string) {
  const startsAt = minutes(input.starts_at)
  const endsAt = minutes(input.ends_at)
  if (startsAt === endsAt) throw new Error("開始和結束不能是同一個時間")
  const found = await db
    .select({ id: doorSounds.id })
    .from(doorSounds)
    .where(inArray(doorSounds.id, input.sound_ids))
  if (found.length !== input.sound_ids.length)
    throw new Error("有音效已經被刪掉了")
  return {
    startsAt,
    endsAt,
    days: mask(input.days),
    enabled: input.enabled,
    soundIds: input.sound_ids,
    updatedBy: userId,
  }
}

export const listDoorSoundRules = defineAction({
  name: "list_door_sound_rules",
  title: "門口音效排程",
  description:
    "The lab's door sound schedule: rules with starts_at, ends_at (HH:MM Asia/Taipei; an end at or before the start runs past midnight), days (1 Monday to 7 Sunday, the day the range starts), sounds ({id, label}) and enabled. A member's own playlist always wins; for members with an empty playlist the door plays one of the sounds of the rules in force, else one of the lab's defaults. now lists the rule ids in force at this moment and now_sounds what such a member would hear; can_edit says whether the caller is a door admin.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [rows, sounds, canEdit] = await Promise.all([
      db
        .select()
        .from(doorSoundRules)
        .orderBy(asc(doorSoundRules.startsAt), asc(doorSoundRules.createdAt)),
      db
        .select({
          id: doorSounds.id,
          label: doorSounds.label,
          isDefault: doorSounds.isDefault,
        })
        .from(doorSounds),
      isAdmin(actor, "door"),
    ])
    const label = new Map(sounds.map((s) => [s.id, s.label]))
    const minute = taipeiWeekMinute(new Date())
    const now = rows.filter((row) => inForce(row, minute))
    const soundsOf = (ids: string[]) =>
      ids.flatMap((id) =>
        label.has(id) ? [{ id, label: label.get(id)! }] : []
      )
    const nowSounds = [
      ...new Map(
        now.flatMap((row) => soundsOf(row.soundIds)).map((s) => [s.id, s])
      ).values(),
    ]
    return {
      rules: rows.map((row) => ({
        id: row.id,
        starts_at: clock(row.startsAt),
        ends_at: clock(row.endsAt),
        days: dayList(row.days),
        sounds: soundsOf(row.soundIds),
        enabled: row.enabled,
      })),
      now: now.map((row) => row.id),
      // Rules whose sounds were all deleted fall through to the defaults.
      now_sounds: nowSounds.length
        ? nowSounds
        : sounds
            .filter((s) => s.isDefault)
            .map(({ id, label }) => ({ id, label })),
      now_from: nowSounds.length
        ? ("schedule" as const)
        : ("defaults" as const),
      can_edit: canEdit,
    }
  },
})

export type DoorSoundRule = Awaited<
  ReturnType<typeof listDoorSoundRules.run>
>["rules"][number]

export const createDoorSoundRule = defineAction({
  name: "create_door_sound_rule",
  admin: "door",
  refreshesDoorPanel: true,
  title: "新增門口音效排程",
  description:
    "Adds a rule to the lab's door sound schedule: during the time range on those days, members with an empty playlist hear one of these pool sounds. Rules may overlap; then the sounds of every rule in force are pooled. Door admins only.",
  kind: "mutation",
  input: fields,
  run: async (actor, input) => {
    await requireAdmin(actor, "door")
    const values = await valuesOf(input, actor.userId)
    const [row] = await db
      .insert(doorSoundRules)
      .values({ ...values, createdBy: actor.userId })
      .returning({ id: doorSoundRules.id })
    return { id: row.id }
  },
})

export const updateDoorSoundRule = defineAction({
  name: "update_door_sound_rule",
  admin: "door",
  refreshesDoorPanel: true,
  title: "修改門口音效排程",
  description:
    "Replaces a door sound rule's times, days, sounds and enabled flag, by its id from list_door_sound_rules. Door admins only.",
  kind: "mutation",
  input: fields.extend({ id: z.uuid("找不到這條排程") }),
  run: async (actor, { id, ...input }) => {
    await requireAdmin(actor, "door")
    const values = await valuesOf(input, actor.userId)
    const [row] = await db
      .update(doorSoundRules)
      .set({ ...values, updatedAt: sql`now()` })
      .where(eq(doorSoundRules.id, id))
      .returning({ id: doorSoundRules.id })
    if (!row) throw new Error("找不到這條排程")
    return { id }
  },
})

export const deleteDoorSoundRule = defineAction({
  name: "delete_door_sound_rule",
  admin: "door",
  refreshesDoorPanel: true,
  title: "刪除門口音效排程",
  description:
    "Deletes a door sound rule by its id. Door admins only; to pause one, update it with enabled false.",
  kind: "mutation",
  input: z.object({ id: z.uuid("找不到這條排程") }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "door")
    const rows = await db
      .delete(doorSoundRules)
      .where(eq(doorSoundRules.id, id))
      .returning({ id: doorSoundRules.id })
    if (!rows.length) throw new Error("找不到這條排程")
    return { deleted: true }
  },
})

/** A rule as the door evaluates it at open time. */
export type PanelSoundRule = {
  start: number
  end: number
  days: number
  sounds: string[]
}

/** The enabled rules with their sounds that still exist, for the panel. */
export async function panelSoundRules(): Promise<PanelSoundRule[]> {
  const [rows, sounds] = await Promise.all([
    db
      .select()
      .from(doorSoundRules)
      .where(and(eq(doorSoundRules.enabled, true)))
      .orderBy(asc(doorSoundRules.startsAt)),
    db.select({ id: doorSounds.id }).from(doorSounds),
  ])
  const exists = new Set(sounds.map((s) => s.id))
  return rows.flatMap((row) => {
    const ids = row.soundIds.filter((id) => exists.has(id))
    return ids.length
      ? [{ start: row.startsAt, end: row.endsAt, days: row.days, sounds: ids }]
      : []
  })
}
