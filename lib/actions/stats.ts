import { asc, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  leaves,
  labMeetingQuestioners,
  labMeetings,
  user,
} from "@/lib/db/schema"
import { taipeiToday } from "@/lib/leave-dates"

export type MemberStats = {
  userId: string
  name: string
  /** Weeks presented, and weeks scheduled from today on. */
  presented: number
  presentScheduled: number
  /** Weeks asked questions, and weeks scheduled to ask. */
  asked: number
  askScheduled: number
  /** Monday meetings missed, and absences signed up for from today on. */
  leaves: number
  leaveScheduled: number
}

export const listLabMeetingStats = defineAction({
  name: "list_lab_meeting_stats",
  title: "報告、提問與請假次數",
  description:
    "How many times each member presented, asked questions and was away at the Monday lab meeting, each split into what already happened and what is scheduled from today in Taipei. A meetings admin gets every member with any record; anyone else gets only themselves.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const today = taipeiToday()
    const everyone = await isAdmin(actor, "meetings")
    const only = everyone ? undefined : [actor.userId]
    const past = (column: unknown) =>
      sql<number>`count(*) filter (where ${column} < ${today})::int`
    const ahead = (column: unknown) =>
      sql<number>`count(*) filter (where ${column} >= ${today})::int`

    const [presenting, asking, away] = await Promise.all([
      db
        .select({
          userId: labMeetings.presenterId,
          done: past(labMeetings.date),
          next: ahead(labMeetings.date),
        })
        .from(labMeetings)
        .where(
          only
            ? inArray(labMeetings.presenterId, only)
            : sql`${labMeetings.presenterId} is not null`
        )
        .groupBy(labMeetings.presenterId),
      db
        .select({
          userId: labMeetingQuestioners.userId,
          done: past(labMeetings.date),
          next: ahead(labMeetings.date),
        })
        .from(labMeetingQuestioners)
        .innerJoin(
          labMeetings,
          sql`${labMeetings.id} = ${labMeetingQuestioners.labMeetingId}`
        )
        .where(only ? inArray(labMeetingQuestioners.userId, only) : undefined)
        .groupBy(labMeetingQuestioners.userId),
      db
        .select({
          userId: leaves.userId,
          done: past(leaves.date),
          next: ahead(leaves.date),
        })
        .from(leaves)
        .where(only ? inArray(leaves.userId, only) : undefined)
        .groupBy(leaves.userId),
    ])

    const ids = new Set(
      [...presenting, ...asking, ...away]
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id))
    )
    if (only) ids.add(actor.userId)
    if (ids.size === 0) return { members: [] as MemberStats[] }
    const names = await db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(inArray(user.id, [...ids]))
      .orderBy(asc(user.name))
    const find = (
      rows: { userId: string | null; done: number; next: number }[],
      id: string
    ) => rows.find((row) => row.userId === id)
    return {
      members: names.map(({ id, name }): MemberStats => ({
        userId: id,
        name,
        presented: find(presenting, id)?.done ?? 0,
        presentScheduled: find(presenting, id)?.next ?? 0,
        asked: find(asking, id)?.done ?? 0,
        askScheduled: find(asking, id)?.next ?? 0,
        leaves: find(away, id)?.done ?? 0,
        leaveScheduled: find(away, id)?.next ?? 0,
      })),
    }
  },
})
