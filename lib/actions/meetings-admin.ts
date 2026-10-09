import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import {
  isoDate,
  optionalText,
  optionalUrl,
  requirePaper,
} from "@/lib/actions/meetings"
import {
  changeSchedule,
  meetingOn,
  presenterRoster,
  QUESTIONERS_PER_WEEK,
} from "@/lib/actions/meetings-shared"
import { meetingKinds, meetingQuestioners, meetings } from "@/lib/db/schema"
import { taipeiToday } from "@/lib/leave-dates"
import { addDays, semesterOf } from "@/lib/semester"

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } })?.cause?.code === "23505"

const kind = z.enum(meetingKinds, "類型是 regular、thesis、speaker 或 holiday")
const time = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "時間格式是 HH:MM")

export const generateSemester = defineAction({
  name: "generate_semester",
  title: "產生學期排程",
  description:
    "Admins only. Adds one meeting a week for a semester: weeks rows starting at start (the first week of classes), 7 days apart, labelled 第 1 週, 第 2 週 and so on, skipping dates that already have one. Dates listed in holidays become holiday weeks with that reason. Presenters are not assigned; use fill_presenters after.",
  kind: "mutation",
  input: z.object({
    start: isoDate,
    weeks: z.number().int().min(1).max(30),
    holidays: z
      .array(
        z.object({
          date: isoDate,
          reason: z.string().trim().min(1, "請填放假原因").max(50),
        })
      )
      .default([]),
  }),
  run: async (actor, { start, weeks, holidays }) => {
    await requireAdmin(actor, "meetings")
    const dates = Array.from({ length: weeks }, (_, week) =>
      addDays(start, week * 7)
    )
    const off = new Map(holidays.map(({ date, reason }) => [date, reason]))
    for (const date of off.keys())
      if (!dates.includes(date)) throw new Error(`${date} 不在這學期的週次裡`)
    return changeSchedule(async (tx) => {
      const added = await tx
        .insert(meetings)
        .values(
          dates.map((date, week) => ({
            date,
            label: `第 ${week + 1} 週`,
            kind: off.has(date) ? ("holiday" as const) : ("regular" as const),
            holiday: off.get(date) ?? null,
          }))
        )
        .onConflictDoNothing()
        .returning({ date: meetings.date })
      return { added: added.length, skipped: weeks - added.length }
    })
  },
})

export const addMeeting = defineAction({
  name: "add_meeting",
  title: "新增一週",
  description: `Admins only. Adds one meeting on date. label is what the lab calls the week (e.g. 寒假); kind is regular (default), thesis, speaker or holiday; holiday says why there is no meeting.`,
  kind: "mutation",
  input: z.object({
    date: isoDate,
    label: optionalText(50),
    kind: kind.default("regular"),
    holiday: optionalText(50),
    title: optionalText(300),
  }),
  run: async (actor, { date, label, kind, holiday, title }) => {
    await requireAdmin(actor, "meetings")
    if (kind === "holiday" && !holiday) throw new Error("請填放假原因")
    return changeSchedule(async (tx) => {
      const [added] = await tx
        .insert(meetings)
        .values({
          date,
          label,
          kind,
          holiday: kind === "holiday" ? holiday : null,
          title: kind === "regular" || kind === "holiday" ? null : title,
        })
        .onConflictDoNothing()
        .returning({ date: meetings.date })
      if (!added) throw new Error(`${date} 已經有會議`)
      return added
    })
  },
})

export const updateMeeting = defineAction({
  name: "update_meeting",
  title: "編輯會議",
  description:
    "Admins only. Changes any part of one week: moves it to newDate, changes its label, kind, holiday reason, presenterId (a member id, or null to open the week), paperId (from list_papers, regular weeks only), title (thesis and speaker weeks), slides and recording links, notes, location and startsAt (HH:MM). Leave a field out to keep it.",
  kind: "mutation",
  input: z.object({
    date: isoDate,
    newDate: isoDate.optional(),
    label: optionalText(50),
    kind: kind.optional(),
    holiday: optionalText(50),
    presenterId: z.uuid().nullish(),
    paperId: z.uuid().nullish(),
    title: optionalText(300),
    slidesUrl: optionalUrl,
    recordingUrl: optionalUrl,
    notes: optionalText(1000),
    location: z.string().trim().min(1).max(100).optional(),
    startsAt: time.optional(),
  }),
  run: async (actor, { date, newDate, ...input }) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const meeting = await meetingOn(tx, date)
      const next = { ...meeting }
      for (const [key, value] of Object.entries(input))
        if (value !== undefined) Object.assign(next, { [key]: value })
      if (newDate) next.date = newDate
      // A kind change drops what the new kind cannot have.
      if (next.kind !== "holiday") next.holiday = null
      if (next.kind === "holiday" && !next.holiday)
        throw new Error("請填放假原因")
      if (next.kind === "holiday" || next.kind === "speaker")
        next.presenterId = null
      if (next.kind !== "regular") next.paperId = null
      if (next.paperId && next.paperId !== meeting.paperId)
        await requirePaper(tx, next.paperId)
      const { id, ...change } = next
      try {
        await tx.update(meetings).set(change).where(eq(meetings.id, id))
      } catch (error) {
        if (isUniqueViolation(error)) throw new Error(`${next.date} 已經有會議`)
        throw error
      }
      return { date: next.date }
    })
  },
})

export const deleteMeeting = defineAction({
  name: "delete_meeting",
  title: "刪除一週",
  description:
    "Admins only. Removes the meeting on date with its questioners. Other weeks do not move.",
  kind: "mutation",
  input: z.object({ date: isoDate }),
  run: async (actor, { date }) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const meeting = await meetingOn(tx, date)
      await tx.delete(meetings).where(eq(meetings.id, meeting.id))
      return { date }
    })
  },
})

// What moves when two weeks swap: who presents and what they present.
const swapped = [
  "kind",
  "presenterId",
  "paperId",
  "title",
  "slidesUrl",
  "recordingUrl",
  "notes",
] as const

export const swapMeetings = defineAction({
  name: "swap_meetings",
  title: "交換兩週",
  description:
    "Admins only. Swaps who presents, and what, between two weeks of the same semester; dates, place and time stay. Holiday and speaker weeks cannot be swapped.",
  kind: "mutation",
  input: z.object({ first: isoDate, second: isoDate }),
  run: async (actor, { first, second }) => {
    await requireAdmin(actor, "meetings")
    if (first === second) throw new Error("請選兩個不同的週")
    if (semesterOf(first).start !== semesterOf(second).start)
      throw new Error("只能交換同一學期的兩週")
    return changeSchedule(async (tx) => {
      const a = await meetingOn(tx, first)
      const b = await meetingOn(tx, second)
      for (const row of [a, b])
        if (row.kind === "holiday" || row.kind === "speaker")
          throw new Error(`${row.date} 是放假或演講週，不能交換`)
      const pick = (row: typeof a) =>
        Object.fromEntries(swapped.map((key) => [key, row[key]]))
      await tx.update(meetings).set(pick(b)).where(eq(meetings.id, a.id))
      await tx.update(meetings).set(pick(a)).where(eq(meetings.id, b.id))
      return { first, second }
    })
  },
})

export const fillPresenters = defineAction({
  name: "fill_presenters",
  title: "自動排報告人",
  description:
    "Admins only. Fills every open regular week from today on with presenters from the presenter list (list_presenters), in turn, starting after the last member already scheduled. Weeks someone already holds are left alone.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const turn = (await presenterRoster(tx))
        .filter((row) => row.inRotation)
        .map((row) => row.userId)
      if (turn.length === 0) throw new Error("報告順序是空的")
      const today = taipeiToday()
      const [last] = await tx
        .select({ presenterId: meetings.presenterId })
        .from(meetings)
        .where(
          and(
            isNotNull(meetings.presenterId),
            eq(meetings.kind, "regular"),
            inArray(meetings.presenterId, turn)
          )
        )
        .orderBy(desc(meetings.date))
        .limit(1)
      const open = await tx
        .select({ id: meetings.id })
        .from(meetings)
        .where(
          and(
            gte(meetings.date, today),
            eq(meetings.kind, "regular"),
            isNull(meetings.presenterId)
          )
        )
        .orderBy(asc(meetings.date))
      let next = last ? turn.indexOf(last.presenterId!) + 1 : 0
      for (const week of open) {
        await tx
          .update(meetings)
          .set({ presenterId: turn[next % turn.length] })
          .where(eq(meetings.id, week.id))
        next += 1
      }
      return { filled: open.length }
    })
  },
})

export const setQuestioners = defineAction({
  name: "set_questioners",
  title: "指定提問人",
  description: `Admins only. Sets who asks questions on one week, up to ${QUESTIONERS_PER_WEEK} member ids. They become fixed picks the automatic assignment never moves; seats left empty are filled automatically. An empty list hands the whole week back to the automatic assignment.`,
  kind: "mutation",
  input: z.object({
    date: isoDate,
    userIds: z
      .array(z.uuid())
      .max(QUESTIONERS_PER_WEEK, `每週最多 ${QUESTIONERS_PER_WEEK} 位`),
  }),
  run: async (actor, { date, userIds }) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const meeting = await meetingOn(tx, date)
      if (date < taipeiToday()) throw new Error(`${date} 已經過了`)
      if (userIds.includes(meeting.presenterId ?? ""))
        throw new Error("報告人不能當自己那週的提問人")
      await tx
        .delete(meetingQuestioners)
        .where(eq(meetingQuestioners.meetingId, meeting.id))
      const unique = [...new Set(userIds)]
      if (unique.length)
        await tx.insert(meetingQuestioners).values(
          unique.map((userId) => ({
            meetingId: meeting.id,
            userId,
            manual: true,
          }))
        )
      return { date }
    })
  },
})
