// Sends mail through the lab's Google Workspace over SMTP, as
// MAIL_FROM (an alias of the SMTP_USER mailbox). Only lib/actions/mail.ts
// calls it, after a mail is queued in mail_outbox.
import { createTransport, type Transporter } from "nodemailer"

export type Mail = {
  to: string[]
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
  await transport.sendMail({ from: process.env.MAIL_FROM, ...mail })
}
