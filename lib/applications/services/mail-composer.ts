import { mailBody } from "@/lib/mail-body"
import type { Application } from "../domain/application"
import type { MailKind } from "../domain/constants"
import type { Email } from "../domain/values"
import type { ComposedMail } from "../ports"

type Urls = { siteUrl: string }

/**
 * The mails an applicant (or a processor) gets; text in Chinese. The apply
 * site's address is a setting, so the caller passes it in.
 */
export class MailComposer {
  constructor(private readonly urls: Urls) {}

  verify(to: Email, token: string, applySite: string): ComposedMail {
    return this.compose("verify", to.value, "確認你的 Email", {
      title: "確認你的 Email",
      paragraphs: ["請按下按鈕確認這個 Email，確認後才會送出你的帳號申請。"],
      action: { label: "確認 Email", url: `${applySite}/confirm/${token}` },
    })
  }

  link(to: Email, token: string, applySite: string): ComposedMail {
    return this.compose("link", to.value, "你的申請狀態連結", {
      title: "你的申請狀態連結",
      paragraphs: ["用這個連結查看申請進度。請不要轉給別人。"],
      action: { label: "查看申請狀態", url: `${applySite}/status/${token}` },
    })
  }

  received(
    app: Application,
    accessToken: string,
    applySite: string
  ): ComposedMail {
    if (!app.email) throw new Error("application has no email")
    return this.compose("received", app.email.value, "我們收到你的帳號申請", {
      title: "我們收到你的帳號申請",
      paragraphs: ["審核後會再通知你。你可以隨時用下面的連結查看進度。"],
      action: {
        label: "查看申請狀態",
        url: `${applySite}/status/${accessToken}`,
      },
    })
  }

  hasAccount(to: Email): ComposedMail {
    return this.compose("has_account", to.value, "你已經有 WinLab 帳號", {
      title: "你已經有 WinLab 帳號",
      paragraphs: ["你已經有帳號，請登入或用登入頁的『忘記密碼』。"],
    })
  }

  /** Names no one: the applicant's data stays in the portal. */
  processorNotice(_app: Application, to: string): ComposedMail {
    const url = `${this.urls.siteUrl}/applications`
    return this.compose("processor_notice", to, "有一筆新的帳號申請", {
      title: "有一筆新的帳號申請",
      paragraphs: ["請到 Portal 審核。"],
      action: { label: "前往審核", url },
    })
  }

  private compose(
    kind: MailKind,
    to: string,
    subject: string,
    body: Parameters<typeof mailBody>[0]
  ): ComposedMail {
    return { kind, to, subject, ...mailBody(body) }
  }
}
