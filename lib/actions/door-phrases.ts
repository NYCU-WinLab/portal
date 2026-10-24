import {
  and,
  asc,
  eq,
  isNull,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { type Actor, defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  doorCards,
  doorGreetings,
  doorPhrases,
  doorVoiceClips,
  user,
} from "@/lib/db/schema"
import {
  clock,
  DEFAULT_BEFORE,
  panelName,
  spokenName,
  taipeiWeekMinute,
  voiceLink,
  voiceParts,
  weekRanges,
} from "@/lib/door-greeting"

// The door's spoken greeting by the time of day: each member's own phrases,
// the lab's defaults that door admins keep, and the voice clips the door
// speaks them with.

const PART_MAX = 40
// Each phrase is a clip the voice job makes for the member's name.
const OWN_MAX = 20
const part = z
  .string()
  .max(200)
  .transform((value) => value.normalize("NFC").trim().replace(/\s+/g, " "))
  .refine((value) => [...value].length <= PART_MAX, `最多 ${PART_MAX} 個字`)
// A plain string in the schema: a transform would make MCP clients see a
// number and turn "06:00" into one before it is sent.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間要像 22:00")
const minutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3))
const lab = z
  .boolean()
  .default(false)
  .describe(
    "true for one of the lab's default phrases (door admins only), false for your own."
  )
const fields = z.object({
  before: part.describe('Said before the name, e.g. "晚安，"; may be empty.'),
  after: part.describe(
    'Said after the name, e.g. "這麼晚來，很認真喔。"; may be empty.'
  ),
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
  enabled: z.boolean().default(true),
  first_visit: z
    .boolean()
    .default(false)
    .describe(
      "Say it only on the member's first opening of the day (the day starts at 06:00 Asia/Taipei); first-visit phrases in force win over the others then."
    ),
  default: lab,
})

const mask = (days: number[]) =>
  days.reduce((bits, day) => bits | (1 << (day - 1)), 0)
const dayList = (bits: number) =>
  [1, 2, 3, 4, 5, 6, 7].filter((day) => bits & (1 << (day - 1)))

type Row = typeof doorPhrases.$inferSelect
const shape = (row: Row) => ({
  id: row.id,
  before: row.before,
  after: row.after,
  starts_at: clock(row.startsAt),
  ends_at: clock(row.endsAt),
  days: dayList(row.days),
  enabled: row.enabled,
  first_visit: row.firstVisit,
  default: row.userId === null,
})
export type DoorPhrase = ReturnType<typeof shape>

const inForce = (rows: Row[], minute: number) =>
  rows.filter(
    (row) =>
      row.enabled &&
      weekRanges(row).some(([start, end]) => start <= minute && minute < end)
  )

/** The rows an actor may change: their own, or the defaults for a door
 * admin. */
async function scope(actor: Actor, isDefault: boolean) {
  if (!isDefault) return eq(doorPhrases.userId, actor.userId)
  await requireAdmin(actor, "door")
  return isNull(doorPhrases.userId)
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Saves a phrase. Phrases may share a time: the door picks one of the
 * phrases in force at random. */
async function save(
  tx: Tx,
  values: Omit<typeof doorPhrases.$inferInsert, "id">,
  where?: { id: string; scope: SQL }
) {
  if (!values.before && !values.after) throw new Error("名字前後至少填一個")
  if (values.startsAt === values.endsAt)
    throw new Error("開始和結束不能是同一個時間")
  if (where) {
    const [row] = await tx
      .update(doorPhrases)
      .set({ ...values, updatedAt: sql`now()` })
      .where(and(eq(doorPhrases.id, where.id), where.scope))
      .returning()
    if (!row) throw new Error("找不到這條問候語")
    return row
  }
  if (values.userId) {
    // One member's creates take turns, so two at once cannot both pass the
    // cap.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('door_phrases'), hashtext(${values.userId}))`
    )
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(doorPhrases)
      .where(eq(doorPhrases.userId, values.userId))
    if (count >= OWN_MAX) throw new Error(`每人最多 ${OWN_MAX} 句`)
  }
  const [row] = await tx.insert(doorPhrases).values(values).returning()
  return row
}

const values = (input: z.infer<typeof fields>, userId: string) => ({
  before: input.before,
  after: input.after,
  startsAt: minutes(input.starts_at),
  endsAt: minutes(input.ends_at),
  days: mask(input.days),
  enabled: input.enabled,
  firstVisit: input.first_visit,
  updatedBy: userId,
})

export const listDoorPhrases = defineAction({
  name: "list_door_phrases",
  title: "門口問候語",
  description:
    'What the door says when you open it, by the time of day: mine is your own phrases, defaults the lab\'s (door admins keep them). Each phrase says before + your name + after (e.g. "晚安，" name "這麼晚來，很認真喔。") from starts_at to ends_at (HH:MM, Asia/Taipei, past midnight when ends_at <= starts_at) on the listed weekdays (1 Monday to 7 Sunday, the day the range starts). At each opening the door picks at random one of your enabled phrases in force, else one of the enabled defaults in force, else says "Hi <name>". first_visit phrases are said only on a member\'s first opening of the day (from 06:00) and win over the others then. now lists the ids the door picks from for you right now; can_edit_defaults tells whether you may change the defaults.',
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [rows, admin] = await Promise.all([
      db
        .select()
        .from(doorPhrases)
        .where(
          or(eq(doorPhrases.userId, actor.userId), isNull(doorPhrases.userId))
        )
        .orderBy(asc(doorPhrases.startsAt), asc(doorPhrases.createdAt)),
      isAdmin(actor, "door"),
    ])
    const mine = rows.filter((row) => row.userId !== null)
    const defaults = rows.filter((row) => row.userId === null)
    const minute = taipeiWeekMinute(new Date())
    const own = inForce(mine, minute)
    const now = (own.length ? own : inForce(defaults, minute)).map(
      (row) => row.id
    )
    return {
      mine: mine.map(shape),
      defaults: defaults.map(shape),
      now,
      can_edit_defaults: admin,
    }
  },
})

export const createDoorPhrase = defineAction({
  name: "create_door_phrase",
  refreshesDoorPanel: true,
  title: "新增門口問候語",
  description:
    "Adds one of your own phrases to what the door says when you open it, or with default true one of the lab's defaults (door admins). The door speaks it in CC's cloned voice once the voice job has made its clips, and in the stock voice until then.",
  kind: "mutation",
  input: fields,
  run: async (actor, input) => {
    await scope(actor, input.default)
    const row = await db.transaction((tx) =>
      save(tx, {
        ...values(input, actor.userId),
        userId: input.default ? null : actor.userId,
        createdBy: actor.userId,
      })
    )
    return shape(row)
  },
})

export const updateDoorPhrase = defineAction({
  name: "update_door_phrase",
  refreshesDoorPanel: true,
  title: "修改門口問候語",
  description:
    "Replaces one of your own phrases, or with default true one of the lab's defaults (door admins); send every field back as list_door_phrases returns it, since a field left out goes back to its default. Set enabled false to pause it without deleting it.",
  kind: "mutation",
  input: fields.extend({ id: z.uuid("找不到這條問候語") }),
  run: async (actor, { id, ...input }) => {
    const where = { id, scope: await scope(actor, input.default) }
    const row = await db.transaction((tx) =>
      save(tx, values(input, actor.userId), where)
    )
    return shape(row)
  },
})

export const deleteDoorPhrase = defineAction({
  name: "delete_door_phrase",
  refreshesDoorPanel: true,
  title: "刪除門口問候語",
  description:
    "Deletes one of your own phrases, or with default true one of the lab's defaults (door admins).",
  kind: "mutation",
  input: z.object({ id: z.uuid("找不到這條問候語"), default: lab }),
  run: async (actor, { id, default: isDefault }) => {
    const [row] = await db
      .delete(doorPhrases)
      .where(and(eq(doorPhrases.id, id), await scope(actor, isDefault)))
      .returning({ id: doorPhrases.id })
    if (!row) throw new Error("找不到這條問候語")
    return { id }
  },
})

export const listDoorVoiceClips = defineAction({
  name: "list_door_voice_clips",
  admin: "door",
  title: "門口語音",
  description:
    'The clips in CC\'s cloned voice that the door speaks greetings with, one per text ("晚安，", "詠翔，", "詠翔。"), and missing: the texts the door needs that have no clip yet, in the order the voice job on furnace makes them. job is that job: online when it asked within the last minute, text the one it is making now, step of steps done. Door admins only.',
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [rows, { missing }] = await Promise.all([
      db
        .select({
          id: doorVoiceClips.id,
          text: doorVoiceClips.text,
          createdAt: doorVoiceClips.createdAt,
        })
        .from(doorVoiceClips)
        .orderBy(asc(doorVoiceClips.text)),
      missingVoiceTexts(),
    ])
    return { clips: rows, missing, job: voiceJobStatus(missing) }
  },
})

export const getDoorVoiceClip = defineAction({
  name: "get_door_voice_clip",
  admin: "door",
  title: "試聽門口語音",
  description:
    "One voice clip as base64 with its content type, to listen to it. Door admins only.",
  kind: "query",
  input: z.object({ id: z.uuid("找不到這段語音") }),
  run: async (actor, { id }) => {
    const clip = await panelVoiceClip(id)
    if (!clip) throw new Error("找不到這段語音")
    return { contentType: clip.type, base64: clip.bytes.toString("base64") }
  },
})

export const deleteDoorVoiceClip = defineAction({
  name: "delete_door_voice_clip",
  admin: "door",
  refreshesDoorPanel: true,
  title: "重錄門口語音",
  description:
    "Deletes one voice clip, for example a badly pronounced name. The door speaks that text in the stock voice until the voice job makes it again, usually within a minute. Door admins only.",
  kind: "mutation",
  input: z.object({ id: z.uuid("找不到這段語音") }),
  run: async (actor, { id }) => {
    const [row] = await db
      .delete(doorVoiceClips)
      .where(eq(doorVoiceClips.id, id))
      .returning({ text: doorVoiceClips.text })
    if (!row) throw new Error("找不到這段語音")
    return { id, text: row.text }
  },
})

// What the door and the voice job read (not actions: both are machines with
// the panel's secret, /api/door/greetings and /api/door/voice).

export type PanelRule = {
  before: string
  after: string
  start: number
  end: number
  days: number
  first: boolean
}

/** The enabled rules, as the door evaluates them at open time: the lab's
 * defaults, and each member's own by the member's id. */
export async function panelPhrases() {
  const rows = await db
    .select()
    .from(doorPhrases)
    .where(eq(doorPhrases.enabled, true))
    .orderBy(asc(doorPhrases.startsAt))
  const defaults: PanelRule[] = []
  const members = new Map<string, PanelRule[]>()
  for (const row of rows) {
    const rule = {
      before: row.before,
      after: row.after,
      start: row.startsAt,
      end: row.endsAt,
      days: row.days,
      first: row.firstVisit,
    }
    if (row.userId === null) defaults.push(rule)
    else members.set(row.userId, [...(members.get(row.userId) ?? []), rule])
  }
  return { defaults, members }
}

/** Every text the door may speak as one clip: each name with the default
 * "Hi，", the defaults' parts and the member's own phrases' parts, the name
 * ending in "。" and, when some rule says more after it, in "，". paused
 * also counts paused rules and members who turned the spoken Hi off, whose
 * clips are kept for when they return. */
export async function voiceTexts({ paused = false } = {}) {
  const [phrases, members, cards, greetings] = await Promise.all([
    db
      .select({
        before: doorPhrases.before,
        after: doorPhrases.after,
        userId: doorPhrases.userId,
      })
      .from(doorPhrases)
      .where(paused ? undefined : eq(doorPhrases.enabled, true)),
    db.select({ id: user.id, name: user.name }).from(user),
    db
      .select({ holderId: doorCards.holderId, name: doorCards.holderName })
      .from(doorCards),
    db
      .select({
        userId: doorGreetings.userId,
        suffix: doorGreetings.suffix,
        speakName: doorGreetings.speakName,
      })
      .from(doorGreetings),
  ])
  const byUser = new Map(greetings.map((row) => [row.userId, row]))
  const defaults = [
    { before: DEFAULT_BEFORE, after: "" },
    ...phrases.filter((rule) => rule.userId === null),
  ]
  const texts = new Set<string>()
  const add = (label: string, userId: string | null) => {
    const greeting = userId ? byUser.get(userId) : undefined
    if (!label || (!paused && greeting?.speakName === false)) return
    const name = spokenName(label, greeting?.suffix ?? null)
    const own = userId ? phrases.filter((rule) => rule.userId === userId) : []
    for (const rule of [...defaults, ...own])
      for (const text of voiceParts(name, rule.before, rule.after))
        texts.add(text)
  }
  for (const member of members) add(panelName(member.name), member.id)
  for (const card of cards) add(panelName(card.name), card.holderId)
  return [...texts].sort()
}

/** Links to the clips the door has, keyed by text. */
export async function panelVoice() {
  const rows = await db
    .select({ id: doorVoiceClips.id, text: doorVoiceClips.text })
    .from(doorVoiceClips)
  return Object.fromEntries(
    rows.map((row) => [row.text, { url: voiceLink(row.id), version: row.id }])
  )
}

/** Deletes the clips for texts the door can no longer say: a deleted rule,
 * a renamed member. A paused rule or a member who turned the spoken Hi off
 * keeps theirs, so turning it back on, even while this runs, finds its
 * clips. The voice job calls this before it asks what is missing. */
export async function pruneVoiceClips() {
  const needed = await voiceTexts({ paused: true })
  // voiceTexts always holds the default "Hi，" parts; an empty list means
  // something went wrong, so keep every clip.
  if (needed.length === 0) return 0
  const pruned = await db
    .delete(doorVoiceClips)
    .where(notInArray(doorVoiceClips.text, needed))
    .returning({ id: doorVoiceClips.id })
  return pruned.length
}

/** The texts the door needs and has no clip for, in the order the voice job
 * makes them: the rules' own parts first, since a new rule waits on those,
 * then the names. */
export async function missingVoiceTexts() {
  const [needed, have, rules] = await Promise.all([
    voiceTexts(),
    db.select({ text: doorVoiceClips.text }).from(doorVoiceClips),
    panelPhrases(),
  ])
  const done = new Set(have.map((row) => row.text))
  const own = new Set(
    [rules.defaults, ...rules.members.values()]
      .flat()
      .flatMap((rule) => voiceParts("", rule.before, rule.after))
  )
  const missing = needed.filter((t) => !done.has(t))
  return {
    needed: needed.length,
    missing: [
      ...missing.filter((t) => own.has(t)),
      ...missing.filter((t) => !own.has(t)),
    ],
  }
}

// The voice job's progress, in this process's memory: it changes every few
// seconds and means nothing after a restart, so it stays out of the
// database. The job reports through /api/door/voice/progress and counts as
// online while it keeps asking /api/door/voice.
type VoiceJob = { text: string | null; step: number; steps: number }
const JOB_ONLINE_MS = 60_000
const voiceJob = ((
  globalThis as { doorVoiceJob?: VoiceJob & { seenAt: number } }
).doorVoiceJob ??= { text: null, step: 0, steps: 0, seenAt: 0 })

/** The voice job asked what is missing. */
export function voiceJobSeen() {
  voiceJob.seenAt = Date.now()
}

/** The voice job is making text, step of steps done; text null when idle. */
export function setVoiceJobProgress(progress: VoiceJob) {
  Object.assign(voiceJob, progress, { seenAt: Date.now() })
}

/** What the voice job is doing, for the door admins' pages. A text that is
 * no longer missing (stored, or its rule deleted) is not shown as in work. */
export function voiceJobStatus(missing: string[]) {
  const online = Date.now() - voiceJob.seenAt < JOB_ONLINE_MS
  const text =
    online && voiceJob.text && missing.includes(voiceJob.text)
      ? voiceJob.text
      : null
  return {
    online,
    text,
    step: text ? voiceJob.step : 0,
    steps: text ? voiceJob.steps : 0,
  }
}
export type VoiceJobStatus = ReturnType<typeof voiceJobStatus>

/** Stores one clip the voice job made. POST only accepts a text that is
 * still missing, so a clip is replaced only after its row is deleted. */
export async function storeVoiceClip(
  text: string,
  audio: Buffer,
  type: string
) {
  await db.transaction(async (tx) => {
    await tx.delete(doorVoiceClips).where(eq(doorVoiceClips.text, text))
    await tx.insert(doorVoiceClips).values({ text, audio, audioType: type })
  })
}

export async function panelVoiceClip(id: string) {
  const [row] = await db
    .select({ audio: doorVoiceClips.audio, type: doorVoiceClips.audioType })
    .from(doorVoiceClips)
    .where(eq(doorVoiceClips.id, id))
  return row ? { bytes: row.audio, type: row.type } : null
}
