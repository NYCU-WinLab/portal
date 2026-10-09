import { eq, max } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { changeSchedule, presenterRoster } from "@/lib/actions/meetings-shared"
import { presenters } from "@/lib/db/schema"

export const listPresenters = defineAction({
  name: "list_presenters",
  title: "報告順序",
  description:
    "The presenter list in turn order: doctoral students, then master's students, each by cohort (ROC admission year) and then by position. status and cohort come live from Keycloak; inRotation is false for anyone no longer a doctoral or master's student, who is skipped for presenting and asking. The same list supplies the questioners.",
  kind: "query",
  input: z.object({}),
  run: async () => ({ presenters: await presenterRoster() }),
})

export const addPresenter = defineAction({
  name: "add_presenter",
  title: "加入報告順序",
  description:
    "Admins only. Adds a member (id from list_members) to the end of their cohort in the presenter list; from then on they present in turn and ask questions.",
  kind: "mutation",
  input: z.object({ userId: z.uuid("請選擇成員") }),
  run: async (actor, { userId }) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const [{ last }] = await tx
        .select({ last: max(presenters.position) })
        .from(presenters)
      const [added] = await tx
        .insert(presenters)
        .values({ userId, position: (last ?? 0) + 1 })
        .onConflictDoNothing()
        .returning({ userId: presenters.userId })
      if (!added) throw new Error("已經在報告順序裡")
      return added
    })
  },
})

export const removePresenter = defineAction({
  name: "remove_presenter",
  title: "移出報告順序",
  description:
    "Admins only. Takes a member off the presenter list, so they are no longer given weeks or questions. Weeks they already hold stay theirs.",
  kind: "mutation",
  input: z.object({ userId: z.uuid() }),
  run: async (actor, { userId }) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const removed = await tx
        .delete(presenters)
        .where(eq(presenters.userId, userId))
        .returning({ userId: presenters.userId })
      if (removed.length === 0) throw new Error("不在報告順序裡")
      return { userId }
    })
  },
})

export const movePresenter = defineAction({
  name: "move_presenter",
  title: "調整報告順序",
  description:
    "Admins only. Moves a member one place up or down within their own status and cohort; the order between cohorts follows Keycloak and cannot be changed here.",
  kind: "mutation",
  input: z.object({ userId: z.uuid(), direction: z.enum(["up", "down"]) }),
  run: async (actor, { userId, direction }) => {
    await requireAdmin(actor, "meetings")
    return changeSchedule(async (tx) => {
      const roster = await presenterRoster(tx)
      const at = roster.findIndex((row) => row.userId === userId)
      if (at < 0) throw new Error("不在報告順序裡")
      const other = roster[direction === "up" ? at - 1 : at + 1]
      const self = roster[at]
      if (
        !other ||
        other.status !== self.status ||
        other.cohort !== self.cohort
      )
        throw new Error(direction === "up" ? "已經在最前面" : "已經在最後面")
      await tx
        .update(presenters)
        .set({ position: other.position })
        .where(eq(presenters.userId, self.userId))
      await tx
        .update(presenters)
        .set({ position: self.position })
        .where(eq(presenters.userId, other.userId))
      return { userId }
    })
  },
})
