import { eq } from "drizzle-orm"
import { z } from "zod"

import { isAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import {
  changeSchedule,
  meetingOn,
  readSchedule,
  type Tx,
} from "@/lib/actions/meetings-shared"
import { meetings, papers } from "@/lib/db/schema"
import { taipeiToday } from "@/lib/leave-dates"

export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD")

/** A link a member pastes, or null to clear it. */
export const optionalUrl = z
  .union([z.url("連結要以 https:// 開頭").max(2000), z.literal("")])
  .nullish()
  .transform((value) => (value === "" ? null : value))

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `最多 ${max} 字`)
    .nullish()
    .transform((value) => (value === "" ? null : value))

const kindDescription =
  "kind is regular (a member presents a paper from the list), thesis (a master's thesis talk, title written by the presenter), speaker (an invited talk, no member presents) or holiday (no meeting; holiday says why)."

export const listMeetings = defineAction({
  name: "list_meetings",
  title: "實驗室會議排程",
  description: `The Monday lab meeting schedule: for each week its date, label (what the lab calls the week, e.g. 第 3 週), semester, kind, presenter, paper or title, slides and recording links, notes, place, start time and questioners. ${kindDescription} past=false (default) gives today in Taipei onward, soonest first; past=true gives earlier weeks, latest first.`,
  kind: "query",
  input: z.object({ past: z.boolean().default(false) }),
  run: async (_actor, { past }) => {
    const today = taipeiToday()
    const schedule = await readSchedule()
    return {
      meetings: past
        ? schedule.filter((row) => row.date < today).reverse()
        : schedule.filter((row) => row.date >= today),
    }
  },
})

export const getNextMeeting = defineAction({
  name: "get_next_meeting",
  title: "下一場實驗室會議",
  description:
    "The next Monday lab meeting that is not a holiday, from today in Taipei: date, presenter, paper or title, place, start time and questioners. null when nothing is scheduled.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const today = taipeiToday()
    const schedule = await readSchedule()
    return {
      meeting:
        schedule.find((row) => row.date >= today && row.kind !== "holiday") ??
        null,
    }
  },
})

export async function requirePaper(tx: Tx, paperId: string) {
  const [paper] = await tx
    .select({ id: papers.id })
    .from(papers)
    .where(eq(papers.id, paperId))
  if (!paper) throw new Error("這篇不在論文清單裡")
}

export const claimMeeting = defineAction({
  name: "claim_meeting",
  title: "認領報告",
  description:
    "Signs the signed-in member up to present at an open regular week: today or later, nobody presenting yet. paperId, from list_papers, is the paper they will present; a regular week's paper must come from that list, and can be set later with update_my_meeting.",
  kind: "mutation",
  input: z.object({ date: isoDate, paperId: z.uuid().nullish() }),
  run: async (actor, { date, paperId }) =>
    changeSchedule(async (tx) => {
      const meeting = await meetingOn(tx, date)
      if (meeting.kind !== "regular") throw new Error(`${date} 不開放認領`)
      if (date < taipeiToday()) throw new Error(`${date} 已經過了`)
      if (meeting.presenterId === actor.userId) return { date }
      if (meeting.presenterId) throw new Error(`${date} 已經有人報告`)
      if (paperId) await requirePaper(tx, paperId)
      await tx
        .update(meetings)
        .set({ presenterId: actor.userId, paperId: paperId ?? null })
        .where(eq(meetings.id, meeting.id))
      return { date }
    }),
})

export const releaseMeeting = defineAction({
  name: "release_meeting",
  title: "取消認領",
  description:
    "Gives back a week the signed-in member is presenting, today or later, leaving it open with its paper and links cleared. Only their own week.",
  kind: "mutation",
  input: z.object({ date: isoDate }),
  run: async (actor, { date }) =>
    changeSchedule(async (tx) => {
      const meeting = await meetingOn(tx, date)
      if (meeting.presenterId !== actor.userId)
        throw new Error(`${date} 不是你報告`)
      if (date < taipeiToday()) throw new Error(`${date} 已經過了`)
      await tx
        .update(meetings)
        .set({
          presenterId: null,
          paperId: null,
          title: null,
          slidesUrl: null,
          recordingUrl: null,
        })
        .where(eq(meetings.id, meeting.id))
      return { date }
    }),
})

export const updateMyMeeting = defineAction({
  name: "update_my_meeting",
  title: "編輯我的報告",
  description:
    "Changes the week the signed-in member presents (an admin may use it on any member's week): paperId from list_papers on a regular week, title on a thesis or speaker week, slides and recording links, notes. Leave a field out to keep it; an empty string clears a link or note.",
  kind: "mutation",
  input: z.object({
    date: isoDate,
    paperId: z.uuid().nullish(),
    title: optionalText(300),
    slidesUrl: optionalUrl,
    recordingUrl: optionalUrl,
    notes: optionalText(1000),
  }),
  run: async (actor, { date, paperId, title, ...links }) =>
    changeSchedule(async (tx) => {
      const meeting = await meetingOn(tx, date)
      if (
        meeting.presenterId !== actor.userId &&
        !(await isAdmin(actor, "meetings"))
      )
        throw new Error(`${date} 不是你報告`)
      const change: Partial<typeof meetings.$inferInsert> = {}
      if (paperId !== undefined) {
        if (meeting.kind !== "regular" && paperId !== null)
          throw new Error("只有一般報告週選論文清單")
        if (paperId) await requirePaper(tx, paperId)
        change.paperId = paperId
      }
      if (title !== undefined) {
        if (meeting.kind === "regular")
          throw new Error("一般報告週的題目來自論文清單")
        change.title = title
      }
      for (const [key, value] of Object.entries(links))
        if (value !== undefined)
          change[key as keyof typeof links] = value as string | null
      if (Object.keys(change).length)
        await tx.update(meetings).set(change).where(eq(meetings.id, meeting.id))
      return { date }
    }),
})
