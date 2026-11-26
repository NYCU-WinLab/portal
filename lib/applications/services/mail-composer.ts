import { mailBody } from "@/lib/mail-body"
import type { Application } from "../domain/application"
import type { MailKind } from "../domain/constants"
import type { Email } from "../domain/values"
import type { ComposedMail } from "../ports"

type Urls = { siteUrl: string }

/** YYYY-MM-DD on the Taipei calendar. */
const taipeiDate = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)

/**
 * The token rides in the query string, never the path, so the apply site can
 * keep it out of access logs and spans by dropping the query. The apply site
 * owns the rest: its GET only shows a page, a button's POST spends the token
 * (a mail scanner's GET must not confirm), and the page sends
 * `Referrer-Policy: no-referrer`.
 */
const tokenLink = (applySite: string, page: string, token: string) =>
  `${applySite}/${page}?token=${encodeURIComponent(token)}`

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
      action: {
        label: "確認 Email",
        url: tokenLink(applySite, "confirm", token),
      },
    })
  }

  link(to: Email, token: string, applySite: string): ComposedMail {
    return this.compose("link", to.value, "你的申請狀態連結", {
      title: "你的申請狀態連結",
      paragraphs: ["用這個連結查看申請進度。請不要轉給別人。"],
      action: {
        label: "查看申請狀態",
        url: tokenLink(applySite, "status", token),
      },
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
        url: tokenLink(applySite, "status", accessToken),
      },
    })
  }

  changesRequested(
    app: Application,
    accessToken: string,
    note: string,
    dueAt: Date,
    applySite: string
  ): ComposedMail {
    if (!app.email) throw new Error("application has no email")
    return this.compose(
      "changes_requested",
      app.email.value,
      "你的帳號申請需要修改",
      {
        title: "你的帳號申請需要修改",
        paragraphs: [
          "審核的人請你修改申請內容：",
          note,
          `請在 ${taipeiDate(dueAt)} 前用下面的連結修改並重新送出。`,
        ],
        action: {
          label: "修改申請",
          url: `${applySite}/status/${accessToken}`,
        },
      }
    )
  }

  rejected(app: Application, note: string | null): ComposedMail {
    if (!app.email) throw new Error("application has no email")
    return this.compose("rejected", app.email.value, "你的帳號申請結果", {
      title: "你的帳號申請結果",
      paragraphs: [
        "很抱歉，這次的帳號申請沒有通過。",
        ...(note ? ["審核的人留了這段話：", note] : []),
      ],
    })
  }

  /** Names no applicant: it only says which group is missing. */
  cohortMissing(to: string, cohort: number, groupPath: string): ComposedMail {
    return this.compose("cohort_missing", to, `缺少 ${cohort} 學年度的群組`, {
      title: `缺少 ${cohort} 學年度的群組`,
      paragraphs: [
        `有人核准了 ${cohort} 學年度的申請，但 Keycloak 沒有這個群組：${groupPath}`,
        "請先建立群組，再回到 Portal 重試。",
      ],
      action: { label: "前往審核", url: `${this.urls.siteUrl}/applications` },
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
