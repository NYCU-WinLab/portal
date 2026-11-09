import { and, count, eq, gt, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import { db } from "@/lib/db"
import { invitations } from "@/lib/db/schema"

// Invitation mail for other lab services: a member (through an API key,
// usually one a service such as viewer.winlab.tw holds) invites someone,
// often without a lab account, to open a link. The mail is a fixed text
// from the lab's address that names the service, never a person: the key
// cannot prove who asked for it. The only free text is the title, one line
// without links, so the one link in the mail is the checked service link.
// Only links into lab services are allowed, so this is no general relay.

/** The services whose links may be mailed. */
const SERVICES: Record<string, string> = {
  "viewer.winlab.tw": "WinLab Viewer",
  "meet.winlab.tw": "WinLab Meet",
}

/** Invitations one member may send in an hour. */
const PER_HOUR = 30

const linkInto = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === "https:" && url.hostname in SERVICES
  }, "只能邀請到實驗室的服務")

/** Text that could pass for a link or an address in a mail. */
const LINKISH =
  /:\/\/|www\.|@|[a-z0-9-]+\.(com|net|org|edu|gov|tw|io|me|co|app|dev|xyz|info|link|ly|cc|ru|cn)\b/i

const title = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value), "標題只能一行")
  .refine((value) => !LINKISH.test(value), "標題不能有網址或信箱")

const ACCESS = { view: "僅檢視", comment: "可註解" } as const

const when = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export const sendInvitation = defineAction({
  name: "send_invitation",
  title: "寄邀請信",
  description:
    "Mails someone an invitation to open a link in a lab service (viewer.winlab.tw or meet.winlab.tw only), from the lab's mail address, in a fixed text that names the service. title names what the link opens (one line, no links or addresses), access the access the link gives (view or comment), expiresAt when the link stops working. At most 30 a member an hour.",
  kind: "mutation",
  input: z.object({
    to: z.email("收件人信箱格式不對"),
    url: linkInto,
    title,
    access: z.enum(["view", "comment"]).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  }),
  run: async (actor, input) => {
    const service = SERVICES[new URL(input.url).hostname]
    return db.transaction(async (tx) => {
      // Serializes one member's invitations, so the limit holds under races.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"invite:" + actor.userId}))`
      )
      const [{ sent }] = await tx
        .select({ sent: count() })
        .from(invitations)
        .where(
          and(
            eq(invitations.senderId, actor.userId),
            gt(invitations.createdAt, sql`now() - interval '1 hour'`)
          )
        )
      if (sent >= PER_HOUR) throw new Error("這一小時寄太多邀請了")
      const lines = [
        `你收到一份 ${service} 的邀請，可以打開「${input.title}」。`,
        "",
        input.url,
        "",
        ...(input.access ? [`權限：${ACCESS[input.access]}。`] : []),
        ...(input.expiresAt
          ? [`連結到 ${when.format(new Date(input.expiresAt))} 失效。`]
          : []),
        "這個連結就是你的通行證，請不要轉給別人。",
      ]
      const outboxId = await queueMail(tx, {
        to: [input.to],
        subject: `${service} 邀請：${input.title}`,
        text: lines.join("\n"),
      })
      const [row] = await tx
        .insert(invitations)
        .values({
          senderId: actor.userId,
          to: input.to,
          url: input.url,
          outboxId,
        })
        .returning({ id: invitations.id })
      return { id: row.id, queued: true }
    })
  },
})
