// Sends mail through the lab's Google Workspace over SMTP, as
// MAIL_FROM (an alias of the SMTP_USER mailbox). Only lib/actions/mail.ts
// calls it, after a mail is queued in mail_outbox.
import { createTransport, type Transporter } from "nodemailer"

export type Mail = {
  to: string[]
  /** Recipients who must not see each other, such as the whole lab. */
  bcc?: string[]
  subject: string
  text: string
  html?: string
  /** Where replies go, such as RSVPs to whoever booked a meeting. */
  replyTo?: string
  /** A calendar invite: mail clients show it with Yes and No buttons. */
  ics?: string
  icsMethod?: "REQUEST" | "CANCEL"
}

let transport: Transporter | null = null

/** False when SMTP is not configured; queued mail then waits. */
export const mailConfigured = () =>
  Boolean(process.env.SMTP_HOST && process.env.SMTP_USER)

export async function sendMail(mail: Mail) {
  transport ??= createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    socketTimeout: 20_000,
  })
  const from = process.env.MAIL_FROM
  // A dev or test deployment sends every mail to MAIL_REDIRECT_TO alone,
  // never to the members it was meant for.
  const redirect = process.env.MAIL_REDIRECT_TO
  const extras = {
    replyTo: mail.replyTo,
    // Only as the text/calendar alternative that clients turn into Yes and
    // No buttons; nodemailer's icalEvent also attaches it a second time.
    alternatives: mail.ics
      ? [
          {
            contentType: `text/calendar; charset=utf-8; method=${mail.icsMethod ?? "REQUEST"}`,
            content: mail.ics,
          },
        ]
      : undefined,
  }
  if (redirect) {
    const meant = mail.to.length + (mail.bcc?.length ?? 0)
    await transport.sendMail({
      from,
      to: redirect,
      subject: `[dev, ${meant} 位收件人] ${mail.subject}`,
      text: mail.text,
      html: mail.html,
      ...extras,
    })
    return
  }
  // A mail with only hidden recipients is addressed to the sender.
  await transport.sendMail({
    from,
    to: mail.to.length ? mail.to : from,
    bcc: mail.bcc,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    ...extras,
  })
}
