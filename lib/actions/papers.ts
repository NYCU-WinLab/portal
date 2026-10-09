import { and, asc, desc, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { optionalText, optionalUrl } from "@/lib/actions/meetings"
import { db } from "@/lib/db"
import {
  meetings,
  paperTagLinks,
  papers,
  paperTags,
  user,
} from "@/lib/db/schema"
import { taipeiToday } from "@/lib/leave-dates"

export const listPapers = defineAction({
  name: "list_papers",
  title: "論文清單",
  description:
    "The papers a presenter may choose from: id, title, link, venue, tags, and every week that uses it (date, presenter, past true when already presented, false when chosen for an upcoming week). A regular week's paper must be one of these; pass its id to update_my_meeting (the presenter) or update_meeting (an admin). tagIds keeps only papers with any of those tags.",
  kind: "query",
  input: z.object({ tagIds: z.array(z.uuid()).default([]) }),
  run: async (_actor, { tagIds }) => {
    const today = taipeiToday()
    const [rows, links, uses] = await Promise.all([
      db
        .select({
          id: papers.id,
          title: papers.title,
          url: papers.url,
          venue: papers.venue,
        })
        .from(papers)
        .orderBy(desc(papers.createdAt), asc(papers.title)),
      db
        .select({
          paperId: paperTagLinks.paperId,
          id: paperTags.id,
          name: paperTags.name,
        })
        .from(paperTagLinks)
        .innerJoin(paperTags, eq(paperTags.id, paperTagLinks.tagId))
        .orderBy(asc(paperTags.name)),
      db
        .select({
          paperId: meetings.paperId,
          date: meetings.date,
          presenter: user.name,
        })
        .from(meetings)
        .leftJoin(user, eq(user.id, meetings.presenterId))
        .where(sql`${meetings.paperId} is not null`)
        .orderBy(asc(meetings.date)),
    ])
    return {
      papers: rows
        .map((paper) => ({
          ...paper,
          tags: links
            .filter((link) => link.paperId === paper.id)
            .map(({ id, name }) => ({ id, name })),
          uses: uses
            .filter((use) => use.paperId === paper.id)
            .map(({ date, presenter }) => ({
              date,
              presenter,
              past: date < today,
            })),
        }))
        .filter(
          (paper) =>
            tagIds.length === 0 ||
            paper.tags.some((tag) => tagIds.includes(tag.id))
        ),
    }
  },
})

export const listPaperTags = defineAction({
  name: "list_paper_tags",
  title: "論文標籤",
  description:
    "The tags papers are filed under (SDN, Kernel/eBPF, ...), with how many papers carry each. Use the ids to filter list_papers or to tag a paper.",
  kind: "query",
  input: z.object({}),
  run: async () => ({
    tags: await db
      .select({
        id: paperTags.id,
        name: paperTags.name,
        papers: sql<number>`count(${paperTagLinks.paperId})::int`,
      })
      .from(paperTags)
      .leftJoin(paperTagLinks, eq(paperTagLinks.tagId, paperTags.id))
      .groupBy(paperTags.id)
      .orderBy(asc(paperTags.name)),
  }),
})

const tagName = z.string().trim().min(1, "請填標籤名稱").max(30)
const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } })?.cause?.code === "23505"

export const addPaperTag = defineAction({
  name: "add_paper_tag",
  title: "新增論文標籤",
  description: "Admins only. Adds a tag papers can be filed under.",
  kind: "mutation",
  input: z.object({ name: tagName }),
  run: async (actor, { name }) => {
    await requireAdmin(actor, "meetings")
    try {
      const [added] = await db
        .insert(paperTags)
        .values({ name })
        .returning({ id: paperTags.id, name: paperTags.name })
      return added
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`已經有「${name}」`)
      throw error
    }
  },
})

export const renamePaperTag = defineAction({
  name: "rename_paper_tag",
  title: "重新命名論文標籤",
  description: "Admins only. Renames a tag; papers keep it.",
  kind: "mutation",
  input: z.object({ id: z.uuid(), name: tagName }),
  run: async (actor, { id, name }) => {
    await requireAdmin(actor, "meetings")
    try {
      const renamed = await db
        .update(paperTags)
        .set({ name })
        .where(eq(paperTags.id, id))
        .returning({ id: paperTags.id })
      if (renamed.length === 0) throw new Error("找不到這個標籤")
      return { id, name }
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(`已經有「${name}」`)
      throw error
    }
  },
})

export const deletePaperTag = defineAction({
  name: "delete_paper_tag",
  title: "刪除論文標籤",
  description:
    "Admins only. Removes a tag and takes it off every paper; the papers stay.",
  kind: "mutation",
  input: z.object({ id: z.uuid() }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "meetings")
    const removed = await db
      .delete(paperTags)
      .where(eq(paperTags.id, id))
      .returning({ id: paperTags.id })
    if (removed.length === 0) throw new Error("找不到這個標籤")
    return { id }
  },
})

const paperFields = {
  title: z.string().trim().min(1, "請填論文標題").max(300),
  url: optionalUrl,
  venue: optionalText(50),
  /** Replaces the paper's tags; leave out to keep them. */
  tagIds: z.array(z.uuid()).optional(),
}

async function setTags(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  paperId: string,
  tagIds: string[]
) {
  await tx.delete(paperTagLinks).where(eq(paperTagLinks.paperId, paperId))
  const unique = [...new Set(tagIds)]
  if (unique.length === 0) return
  const known = await tx
    .select({ id: paperTags.id })
    .from(paperTags)
    .where(inArray(paperTags.id, unique))
  if (known.length !== unique.length) throw new Error("有標籤不存在")
  await tx
    .insert(paperTagLinks)
    .values(unique.map((tagId) => ({ paperId, tagId })))
}

export const addPaper = defineAction({
  name: "add_paper",
  title: "新增論文",
  description:
    "Admins only. Adds a paper presenters may choose: title, optional link, venue (e.g. NSDI'24) and tagIds from list_paper_tags.",
  kind: "mutation",
  input: z.object(paperFields),
  run: async (actor, { tagIds, ...input }) => {
    await requireAdmin(actor, "meetings")
    return db.transaction(async (tx) => {
      const [added] = await tx
        .insert(papers)
        .values({ ...input, addedBy: actor.userId })
        .returning({ id: papers.id, title: papers.title })
      if (tagIds) await setTags(tx, added.id, tagIds)
      return added
    })
  },
})

export const updatePaper = defineAction({
  name: "update_paper",
  title: "編輯論文",
  description:
    "Admins only. Changes a paper's title, link, venue or tags (tagIds replaces them); weeks presenting it show the change.",
  kind: "mutation",
  input: z.object({ id: z.uuid(), ...paperFields }),
  run: async (actor, { id, tagIds, ...input }) => {
    await requireAdmin(actor, "meetings")
    return db.transaction(async (tx) => {
      const updated = await tx
        .update(papers)
        .set(input)
        .where(eq(papers.id, id))
        .returning({ id: papers.id })
      if (updated.length === 0) throw new Error("找不到這篇論文")
      if (tagIds) await setTags(tx, id, tagIds)
      return { id }
    })
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
      .where(and(eq(meetings.paperId, id)))
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
