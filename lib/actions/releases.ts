import { and, desc, eq, gt, lt, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { releaseNotes, releaseReads } from "@/lib/db/schema"

// Release notes: what changed for members, written in each PR as
// release-notes/<slug>.md and published by the deploy (scripts/migrate.ts).
// The dialog shows a member the notes since they last closed it, at most
// after every deploy that brings new ones; /changelog lists them all.

const columns = {
  slug: releaseNotes.slug,
  body: releaseNotes.body,
  sha: releaseNotes.sha,
  publishedAt: releaseNotes.publishedAt,
}

/** A new member, or one away long, sees at most the last 7 days. */
const firstLook = sql`now() - interval '7 days'`

export const listReleaseNotes = defineAction({
  name: "list_release_notes",
  title: "版本更新",
  description:
    "What changed in the portal for members, newest first: slug, body (Chinese, one change per line), sha (the commit deployed with it, as in the bottom-left build) and published_at. before pages back by published_at.",
  kind: "query",
  input: z.object({
    limit: z.number().int().min(1).max(200).default(100),
    before: z.iso.datetime({ offset: true }).optional(),
  }),
  run: async (_actor, { limit, before }) => {
    const notes = await db
      .select(columns)
      .from(releaseNotes)
      .where(
        before ? lt(releaseNotes.publishedAt, new Date(before)) : undefined
      )
      .orderBy(desc(releaseNotes.publishedAt), releaseNotes.slug)
      .limit(limit)
    return { notes }
  },
})

export const getUnseenReleaseNotes = defineAction({
  name: "get_unseen_release_notes",
  title: "沒看過的更新",
  description:
    "The release notes the signed-in member has not seen, newest first (at most the last 7 days), published after they last closed the release dialog.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [read] = await db
      .select({ seenAt: releaseReads.seenAt })
      .from(releaseReads)
      .where(eq(releaseReads.userId, actor.userId))
    const notes = await db
      .select(columns)
      .from(releaseNotes)
      .where(
        and(
          gt(releaseNotes.publishedAt, firstLook),
          read ? gt(releaseNotes.publishedAt, read.seenAt) : undefined
        )
      )
      .orderBy(desc(releaseNotes.publishedAt), releaseNotes.slug)
      .limit(100)
    return { notes }
  },
})

export const markReleaseNotesSeen = defineAction({
  name: "mark_release_notes_seen",
  title: "看過更新",
  description:
    "Marks every release note so far as seen by the signed-in member, so the release dialog stays closed until a newer note is published.",
  kind: "mutation",
  quiet: true,
  input: z.object({}),
  run: async (actor) => {
    await db
      .insert(releaseReads)
      .values({ userId: actor.userId })
      .onConflictDoUpdate({
        target: releaseReads.userId,
        set: { seenAt: sql`now()` },
      })
    return { ok: true }
  },
})
