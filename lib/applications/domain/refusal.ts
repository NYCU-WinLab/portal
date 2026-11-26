import { Refusal } from "@/lib/refusal"

export const REFUSAL_CODES = [
  "invalid_input",
  "rate_limited",
  "link_invalid",
  "wrong_state",
  "edit_window_closed",
  "password_already_set",
  "version_conflict",
  "already_decided",
  "status_not_allowed",
  "username_unavailable",
  "email_has_account",
  "cohort_group_missing",
  "mail_group_not_allowed",
  "member_not_found",
] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/** The codes an applicant may see; the rest are for processors. */
export const APPLICANT_CODES: readonly RefusalCode[] = REFUSAL_CODES.slice(0, 6)

const FIELD_NAMES: Record<string, string> = {
  email: "Email",
  username: "username",
  chinese_name: "中文名字",
  first_name: "First Name",
  last_name: "Last Name",
  student_id: "學號",
  birthday: "生日",
  phone: "電話",
  nycu_email: "交大 Email",
  department: "系所",
  line_id: "LINE ID",
  requested_status: "申請身分",
  status: "身分",
  cohort: "學年度",
  note: "說明",
  apply_site_url: "申請網站網址",
}

const MESSAGES: Record<Exclude<RefusalCode, "invalid_input">, string> = {
  rate_limited: "太頻繁了，請稍後再試",
  link_invalid: "連結無效或已過期",
  wrong_state: "這筆申請目前的狀態不能做這件事",
  edit_window_closed: "修改期限已過",
  password_already_set: "密碼已經設定好了，請用登入頁的「忘記密碼」",
  version_conflict: "這筆申請剛被別人改過，請重新整理",
  already_decided: "這筆申請已經用不同的設定核准了",
  status_not_allowed: "你不能指定這個身分",
  username_unavailable: "這個 username 已被使用",
  email_has_account: "這個 email 已經有帳號",
  cohort_group_missing: "Keycloak 還沒有這個學年度的群組",
  mail_group_not_allowed: "你不能把人加進這個群組信",
  member_not_found: "找不到這位成員",
}

export class ApplicationRefusal extends Refusal {
  constructor(
    readonly code: RefusalCode,
    readonly field?: string
  ) {
    super(field ? `${code}:${field}` : code)
  }

  /** The message processors see. */
  get chinese(): string {
    if (this.code !== "invalid_input") return MESSAGES[this.code]
    if (!this.field) return "輸入格式不對"
    return `${FIELD_NAMES[this.field] ?? this.field}格式不對`
  }
}
