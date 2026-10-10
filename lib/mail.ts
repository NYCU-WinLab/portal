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
  // A mail with only hidden recipients is addressed to the sender.
  await transport.sendMail({
    from,
    ...mail,
    to: mail.to.length ? mail.to : from,
  })
}
