import { desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { mailStatus, queueMail } from "@/lib/actions/mail"
import { db } from "@/lib/db"
import { announcements, mailOutbox, user } from "@/lib/db/schema"
import { labDirectory } from "@/lib/keycloak"

const id = z.uuid("id 格式不對")
const title = z.string().trim().min(1, "請填標題").max(100, "標題最多 100 字")
const content = z
  .string()
  .trim()
  .min(1, "請填內容")
  .max(5000, "內容最多 5000 字")

/** Everyone in the lab who has not left, by the Keycloak groups. */
async function labEmails() {
  const directory = await labDirectory()
  return [...directory.values()].flatMap((member) =>
    member.email && member.status !== "alumni" ? [member.email] : []
  )
}

function announcementMail(post: { title: string; content: string }) {
  const link = `${process.env.BETTER_AUTH_URL}/bulletin`
  return {
    subject: `[WinLab 公告] ${post.title}`,
    text: `${post.content}\n\n${link}`,
  }
}

export const listAnnouncements = defineAction({
  name: "list_announcements",
  title: "公告",
  description:
    "Lab announcements, newest first, each with id, title, full content, author name, created_at, updated_at and mail: null when it was posted without mail, otherwise the mail's status (queued, sent or failed) and how many members it went to. Every member sees the same list.",
  kind: "query",
  input: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
  run: async (_actor, { limit }) => {
    const rows = await db
      .select({
        id: announcements.id,
        title: announcements.title,
        content: announcements.content,
        author: user.name,
        createdAt: announcements.createdAt,
        updatedAt: announcements.updatedAt,
        mailId: announcements.mailId,
        sentAt: mailOutbox.sentAt,
        attempts: mailOutbox.attempts,
        recipients: sql<number>`cardinality(${mailOutbox.bcc})`,
      })
      .from(announcements)
      .leftJoin(user, eq(user.id, announcements.authorId))
      .leftJoin(mailOutbox, eq(mailOutbox.id, announcements.mailId))
      .orderBy(desc(announcements.createdAt))
      .limit(limit)
    return {
      announcements: rows.map(
        ({ mailId, sentAt, attempts, recipients, ...post }) => ({
          ...post,
          mail: mailId
            ? { status: mailStatus({ sentAt, attempts }), recipients }
            : null,
        })
      ),
    }
  },
})

export const createAnnouncement = defineAction({
  name: "create_announcement",
  title: "發公告",
  description:
    "Posts an announcement to the lab board, for portal admins only. notify=true also mails it to every current lab member (the Keycloak /lab-member groups, alumni left out), once; notify=false posts quietly. Mail cannot be recalled, so confirm the wording and whether to notify with the member first.",
  kind: "mutation",
  input: z.object({ title, content, notify: z.boolean().default(false) }),
  run: async (actor, post) => {
    await requireAdmin(actor, "portal")
    const bcc = post.notify ? await labEmails() : []
    if (post.notify && bcc.length === 0)
      throw new Error("找不到實驗室成員的信箱，沒有發出")
    return db.transaction(async (tx) => {
      const mailId = post.notify
        ? await queueMail(tx, { to: [], bcc, ...announcementMail(post) })
        : null
      const [created] = await tx
        .insert(announcements)
        .values({
          title: post.title,
          content: post.content,
          authorId: actor.userId,
          mailId,
        })
        .returning({ id: announcements.id, title: announcements.title })
      return { ...created, mailedTo: bcc.length }
    })
  },
})

export const updateAnnouncement = defineAction({
  name: "update_announcement",
  title: "編輯公告",
  description:
    "Changes an announcement's title and content, for portal admins only. Never mails again, even when the post was mailed; members see the change on the board.",
  kind: "mutation",
  input: z.object({ id, title, content }),
  run: async (actor, { id, title, content }) => {
    await requireAdmin(actor, "portal")
    const [updated] = await db
      .update(announcements)
      .set({ title, content, updatedAt: sql`now()` })
      .where(eq(announcements.id, id))
      .returning({ id: announcements.id })
    if (!updated) throw new Error("找不到這則公告")
    return updated
  },
})

export const deleteAnnouncement = defineAction({
  name: "delete_announcement",
  title: "刪除公告",
  description:
    "Deletes an announcement from the board, for portal admins only. Mail already sent stays in members' inboxes; mail still queued is not sent.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAdmin(actor, "portal")
    return db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(announcements)
        .where(eq(announcements.id, id))
        .returning({ id: announcements.id, mailId: announcements.mailId })
      if (!removed) throw new Error("找不到這則公告")
      if (removed.mailId)
        await tx
          .delete(mailOutbox)
          .where(
            sql`${mailOutbox.id} = ${removed.mailId} and ${mailOutbox.sentAt} is null`
          )
      return { id: removed.id }
    })
  },
})
