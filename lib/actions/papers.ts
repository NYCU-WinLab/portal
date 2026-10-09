import { asc, desc, eq, max } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { optionalText, optionalUrl } from "@/lib/actions/meetings"
import { db } from "@/lib/db"
import { meetings, papers } from "@/lib/db/schema"

export const listPapers = defineAction({
  name: "list_papers",
  title: "論文清單",
  description:
    "The papers a presenter may choose from: id, title, link, venue, and the last meeting date it was presented (null if never). A regular week's paper must be one of these; pass its id to claim_meeting or update_my_meeting.",
  kind: "query",
  input: z.object({}),
  run: async () => ({
    papers: await db
      .select({
        id: papers.id,
        title: papers.title,
        url: papers.url,
        venue: papers.venue,
        lastPresented: max(meetings.date),
      })
      .from(papers)
      .leftJoin(meetings, eq(meetings.paperId, papers.id))
      .groupBy(papers.id)
      .orderBy(desc(papers.createdAt), asc(papers.title)),
  }),
})

const paperFields = {
  title: z.string().trim().min(1, "請填論文標題").max(300),
  url: optionalUrl,
  venue: optionalText(50),
}

export const addPaper = defineAction({
  name: "add_paper",
  title: "新增論文",
  description:
    "Admins only. Adds a paper presenters may choose: title, optional link and venue (e.g. NSDI'24).",
  kind: "mutation",
  input: z.object(paperFields),
  run: async (actor, input) => {
    await requireAdmin(actor, "meetings")
    const [added] = await db
      .insert(papers)
      .values({ ...input, addedBy: actor.userId })
      .returning({ id: papers.id, title: papers.title })
    return added
  },
})

export const updatePaper = defineAction({
  name: "update_paper",
  title: "編輯論文",
  description:
    "Admins only. Changes a paper's title, link or venue; weeks presenting it show the change.",
  kind: "mutation",
  input: z.object({ id: z.uuid(), ...paperFields }),
  run: async (actor, { id, ...input }) => {
    await requireAdmin(actor, "meetings")
    const updated = await db
      .update(papers)
      .set(input)
      .where(eq(papers.id, id))
      .returning({ id: papers.id })
    if (updated.length === 0) throw new Error("找不到這篇論文")
    return { id }
  },
})

export const deletePaper = defineAction({
  name: "delete_paper",
  title: "刪除論文",
  description:
    "Admins only. Removes a paper from the list. Fails while any week presents it.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "meetings")
    const [used] = await db
      .select({ date: meetings.date })
      .from(meetings)
      .where(eq(meetings.paperId, id))
      .limit(1)
    if (used) throw new Error(`${used.date} 的報告用了這篇，不能刪`)
    const removed = await db
      .delete(papers)
      .where(eq(papers.id, id))
      .returning({ id: papers.id })
    if (removed.length === 0) throw new Error("找不到這篇論文")
    return { id }
  },
})
