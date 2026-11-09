import { and, count, eq, gt, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { queueMail } from "@/lib/actions/mail"
import { db } from "@/lib/db"
import { invitations } from "@/lib/db/schema"
import { mailBody } from "@/lib/mail-body"

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

/** Invitations one member may send in an hour; a service key, which sends
 * for everyone using its service, may send more. */
const PER_HOUR = 30
const PER_HOUR_SERVICE = 300

// The mail prints the parsed link (url.href), never the caller's string,
// and only a plain https link into a service: printable ASCII with no
// spaces, no backslash or @, no user or password, no port and no second scheme in it.
const linkInto = z
  .string()
  .max(500)
  .refine(
    (value) => /^https:\/\/[\x21-\x7e]+$/.test(value) && !/[\\@]/.test(value),
    "連結格式不對"
  )
  .refine((value) => {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    return (
      url.protocol === "https:" &&
      url.hostname in SERVICES &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.href.slice("https://".length).includes("//")
    )
  }, "只能邀請到實驗室的服務")
  .transform((value) => new URL(value).href)

/** A dot of any width or script between two letters or digits. */
const DOTTED = /[\p{L}\p{N}][.\u2024\u3002\uFE52\uFF0E\uFF61][\p{L}\p{N}]/u

// One line of plain words: compared after NFKC, so full-width forms count
// as their ASCII twins. Any word.word shape is refused, not a list of
// TLDs, so no domain gets through; a file name drops its extension first.
const title = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value), "標題只能一行")
  .refine((value) => {
    const plain = value.normalize("NFKC")
    return !/[@:\/\\]/.test(plain) && !DOTTED.test(plain)
  }, "標題不能有網址或信箱")

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
    "Mails someone an invitation to open a link in a lab service (viewer.winlab.tw or meet.winlab.tw only), from the lab's mail address, in a fixed text that names the service. title names what the link opens (one line of plain words: no link, address, slash, colon or dotted word such as a file extension), access the access the link gives (view or comment), expiresAt when the link stops working. At most 30 an hour for a member, 300 for a service key.",
  kind: "mutation",
  input: z.object({
    to: z.email("收件人信箱格式不對"),
    url: linkInto,
    title,
    access: z.enum(["view", "comment"]).optional(),
    expiresAt: z.iso
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) > Date.now(), "失效時間已經過了")
      .optional(),
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
      if (sent >= (actor.service ? PER_HOUR_SERVICE : PER_HOUR))
        throw new Error("這一小時寄太多邀請了")
      const rows: [string, string][] = [
        ...(input.access
          ? [["權限", ACCESS[input.access]] as [string, string]]
          : []),
        ...(input.expiresAt
          ? [
              ["失效", when.format(new Date(input.expiresAt))] as [
                string,
                string,
              ],
            ]
          : []),
      ]
      const outboxId = await queueMail(tx, {
        to: [input.to],
        subject: `${service} 邀請：${input.title}`,
        ...mailBody({
          title: input.title,
          rows,
          paragraphs: [
            `你收到一份 ${service} 的邀請。`,
            "這個連結就是你的通行證，請不要轉給別人。",
          ],
          action: { label: `在 ${service} 打開`, url: input.url },
        }),
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
