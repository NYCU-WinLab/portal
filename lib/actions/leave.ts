import { and, asc, desc, eq, gte, lt } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { leaves, user } from "@/lib/db/schema"
import { taipeiToday, upcomingMondays } from "@/lib/leave-dates"

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD")

export const listLeaves = defineAction({
  name: "list_leaves",
  title: "請假名單",
  description:
    "Who is away from the Monday lab meetings, grouped by meeting date with each member's id, name and reason. Every member sees every sign-up. past=false (default) gives today in Taipei onward, soonest first; past=true gives earlier meetings, latest first.",
  kind: "query",
  input: z.object({ past: z.boolean().default(false) }),
  run: async (_actor, { past }) => {
    const today = taipeiToday()
    const rows = await db
      .select({
        date: leaves.date,
        userId: leaves.userId,
        name: user.name,
        reason: leaves.reason,
      })
      .from(leaves)
      .innerJoin(user, eq(user.id, leaves.userId))
      .where(past ? lt(leaves.date, today) : gte(leaves.date, today))
      .orderBy(
        past ? desc(leaves.date) : asc(leaves.date),
        asc(leaves.createdAt)
      )
    const dates = new Map<
      string,
      { userId: string; name: string; reason: string }[]
    >()
    for (const { date, ...member } of rows) {
      dates.set(date, [...(dates.get(date) ?? []), member])
    }
    return {
      dates: [...dates].map(([date, members]) => ({ date, members })),
    }
  },
})

export const createLeave = defineAction({
  name: "create_leave",
  title: "請假",
  description:
    "Signs the signed-in member up as away from one Monday lab meeting. date must be one of the next 8 Mondays (today counts if Monday), the same choices the page offers; one sign-up per member per Monday. The reason is shown to the whole lab, so confirm the date and wording with the member first.",
  kind: "mutation",
  input: z.object({
    date: isoDate,
    reason: z.string().trim().min(1, "請填原因").max(200, "原因最多 200 字"),
  }),
  run: async (actor, { date, reason }) => {
    const allowed = upcomingMondays()
    if (!allowed.includes(date)) {
      throw new Error(
        `只能請 ${allowed[0]} 到 ${allowed.at(-1)} 之間的週一，不能請 ${date}`
      )
    }
    const [created] = await db
      .insert(leaves)
      .values({ userId: actor.userId, date, reason })
      .onConflictDoNothing()
      .returning({ date: leaves.date, reason: leaves.reason })
    if (!created) throw new Error(`${date} 已經請過假了`)
    return created
  },
})

export const deleteLeave = defineAction({
  name: "delete_leave",
  title: "撤回請假",
  description:
    "Withdraws the signed-in member's own sign-up for one Monday meeting, putting them back on the attending list. Only their own; fails when they have none on that date.",
  kind: "mutation",
  input: z.object({ date: isoDate }),
  run: async (actor, { date }) => {
    const removed = await db
      .delete(leaves)
      .where(and(eq(leaves.userId, actor.userId), eq(leaves.date, date)))
      .returning({ date: leaves.date })
    if (removed.length === 0) throw new Error(`${date} 沒有你的請假`)
    return { date }
  },
})
