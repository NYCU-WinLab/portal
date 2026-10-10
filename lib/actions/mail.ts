// The outbox. queueMail adds a mail inside the caller's transaction; the
// sender in this process picks queued mail up after every mutation (the
// same NOTIFY that refreshes pages) and once a minute, so a mail survives a
// restart or an SMTP outage and goes out once it can.
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm"

import { onChange } from "@/lib/actions/changes"
import { db, type Db } from "@/lib/db"
import { mailOutbox } from "@/lib/db/schema"
import { mailConfigured, sendMail, type Mail } from "@/lib/mail"
import { emitErrorLog, traced } from "@/lib/otel"

const MAX_ATTEMPTS = 5

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0]

/** Queues mail; pass the action's transaction so it commits with the
 * change. Returns the outbox id, or null when there is no recipient. */
export async function queueMail(tx: Db | Tx, mail: Mail) {
  if (!mail.to.length && !mail.bcc?.length) return null
  const [row] = await tx
    .insert(mailOutbox)
    .values(mail)
    .returning({ id: mailOutbox.id })
  return row.id
}

/** Where a queued mail stands, for the page that queued it. */
export function mailStatus(mail: {
  sentAt: Date | null
  attempts: number | null
}) {
  if (mail.sentAt) return "sent" as const
  return (mail.attempts ?? 0) >= MAX_ATTEMPTS
    ? ("failed" as const)
    : ("queued" as const)
}

let sending: Promise<void> | null = null

/** Sends what is queued; overlapping calls share one run. */
export function sendQueued() {
  sending ??= traced("mail send", {}, drain).finally(() => {
    sending = null
  })
  return sending
}

async function drain() {
  if (!mailConfigured()) return
  for (;;) {
    // Each row is claimed and sent in its own transaction; SKIP LOCKED keeps
    // a second process from sending it twice.
    const done = await db.transaction(async (tx) => {
      const [mail] = await tx
        .select()
        .from(mailOutbox)
        .where(
          and(isNull(mailOutbox.sentAt), lt(mailOutbox.attempts, MAX_ATTEMPTS))
        )
        .orderBy(asc(mailOutbox.createdAt))
        .limit(1)
        .for("update", { skipLocked: true })
      if (!mail) return true
      try {
        await sendMail({
          to: mail.to,
          bcc: mail.bcc,
          subject: mail.subject,
          text: mail.text,
          html: mail.html ?? undefined,
        })
        await tx
          .update(mailOutbox)
          .set({ sentAt: sql`now()`, attempts: mail.attempts + 1 })
          .where(eq(mailOutbox.id, mail.id))
      } catch (error) {
        emitErrorLog(error, {
          "mail.id": mail.id,
          "mail.attempt": mail.attempts + 1,
        })
        await tx
          .update(mailOutbox)
          .set({
            attempts: mail.attempts + 1,
            lastError: error instanceof Error ? error.message : String(error),
          })
          .where(eq(mailOutbox.id, mail.id))
        // Leave the rest for the next run rather than hammer a failing server.
        return true
      }
      return false
    })
    if (done) return
  }
}

/** Starts the sender; called once per server process from instrumentation. */
export async function startMailSender() {
  if (!mailConfigured()) return
  const run = () => void sendQueued().catch(() => {})
  await onChange(run).catch(() => {})
  setInterval(run, 60_000).unref()
  run()
}
