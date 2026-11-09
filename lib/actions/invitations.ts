import { and, count, eq, gt, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import { db } from "@/lib/db"
import { invitations, user } from "@/lib/db/schema"

// Invitation mail for other lab services: a member (through an API key,
// usually one a service such as viewer.winlab.tw holds) invites someone,
// often without a lab account, to open a link. The mail is a fixed text
// from the lab's address, naming the inviter and the link; replies go to
// the inviter. Only links into lab services are allowed, so this is no
// general mail relay.

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
    "Mails someone an invitation to open a link in a lab service (viewer.winlab.tw or meet.winlab.tw only), from the lab's mail address. inviter is the lab member who invites, by email (must be a portal member; replies go to them; defaults to the caller). title names what the link opens, note is an optional line such as the access given, expiresAt when the link stops working. At most 30 a member an hour.",
  kind: "mutation",
  input: z.object({
    to: z.email("收件人信箱格式不對"),
    url: linkInto,
    title: z.string().trim().min(1).max(120),
    note: z.string().trim().max(200).optional(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
    inviter: z.email().optional(),
  }),
  run: async (actor, input) => {
    const [caller] = await db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, actor.userId))
    if (!caller) throw new Error("找不到你的帳號")
    let inviter = caller
    if (input.inviter && input.inviter.toLowerCase() !== caller.email) {
      const [named] = await db
        .select({ name: user.name, email: user.email })
        .from(user)
        .where(eq(sql`lower(${user.email})`, input.inviter.toLowerCase()))
      if (!named) throw new Error("邀請人不是實驗室成員")
      inviter = named
    }
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
        `${inviter.name} 邀請你在 ${service} 打開「${input.title}」。`,
        "",
        input.url,
        "",
        ...(input.note ? [input.note] : []),
        ...(input.expiresAt
          ? [`連結到 ${when.format(new Date(input.expiresAt))} 失效。`]
          : []),
        "這個連結就是你的通行證，請不要轉給別人。",
      ]
      const outboxId = await queueMail(tx, {
        to: [input.to],
        subject: `${inviter.name} 邀請你打開「${input.title}」`,
        text: lines.join("\n"),
        replyTo: inviter.email,
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
