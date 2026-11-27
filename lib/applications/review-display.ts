// What the review pages show: Chinese labels for statuses, steps and events,
// and the small decisions the dialogs make before calling an action. Plain
// functions over the views, so they are tested without a page.
import {
  STEP_NAMES,
  type ApplicationStatus,
  type EventKind,
  type LabStatus,
  type RequestedStatus,
  type StepName,
} from "./domain/constants"
import { ApplicationRefusal, FIELD_NAMES } from "./domain/refusal"
import { KeycloakUnavailable, MailGroupsUnavailable } from "./ports"
import type { ProfileView, ReviewItem } from "./views"

type BadgeVariant =
  "default" | "muted" | "outline" | "destructive" | "success" | "warning"

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  unverified: "未驗證",
  pending: "待審核",
  changes_requested: "待申請人修改",
  provisioning: "建立帳號中",
  accepted: "已核准",
  rejected: "已退回",
  withdrawn: "已撤回",
}

/** DESIGN.md: waiting on someone warning, done success, rejected destructive,
 * in progress default, closed muted. */
export const STATUS_BADGES: Record<ApplicationStatus, BadgeVariant> = {
  unverified: "muted",
  pending: "warning",
  changes_requested: "warning",
  provisioning: "default",
  accepted: "success",
  rejected: "destructive",
  withdrawn: "muted",
}

export const LAB_STATUS_LABELS: Record<LabStatus, string> = {
  teacher: "老師",
  assistant: "助理",
  doctoral: "博士",
  master: "碩士",
  undergrad: "大學部",
}

export const REQUESTED_STATUS_LABELS: Record<RequestedStatus, string> = {
  master: "碩士",
  doctoral: "博士",
}

export const STEP_LABELS: Record<StepName, string> = {
  create_account: "建立帳號並加入群組",
  join_mail_groups: "加入群組信",
  activate_and_mail: "啟用並寄設定密碼信",
  finish: "完成",
}

export const EVENT_LABELS: Record<EventKind, string> = {
  submitted: "送出申請",
  verified: "確認 email",
  edited: "修改資料",
  changes_requested: "請申請人修改",
  resubmitted: "重新送出",
  accepted: "核准",
  provision_step: "完成一個步驟",
  provision_failed: "步驟失敗",
  provision_blocked: "建立帳號卡住",
  provision_retried: "重試建立帳號",
  provisioned: "帳號建好",
  rejected: "退回",
  withdrawn: "撤回",
  link_sent: "寄出進度連結",
  password_mail_sent: "寄出設定密碼信",
  purged: "清除資料",
}

/** The profile fields a processor may correct, in form order. */
export const PROFILE_FIELDS: {
  key: keyof ProfileView
  label: string
  optional?: true
}[] = [
  { key: "chineseName", label: "中文名字" },
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "username", label: "username" },
  { key: "studentId", label: "學號", optional: true },
  { key: "birthday", label: "生日" },
  { key: "phone", label: "電話" },
  { key: "nycuEmail", label: "交大 Email", optional: true },
  { key: "department", label: "系所" },
  { key: "lineId", label: "LINE ID" },
]

/** Who did it. An admin event whose member was deleted keeps no id. */
export function actorName(
  event: Pick<ReviewItem["events"][number], "actorKind" | "actorId">,
  names: ReadonlyMap<string, string>
): string {
  if (event.actorKind === "applicant") return "申請人"
  if (event.actorKind === "system") return "系統"
  if (event.actorId === null) return "已刪除的處理者"
  return names.get(event.actorId) ?? "處理者"
}

/** A processor's message for an application refusal or a Keycloak outage;
 * null for any other error, which the page reports as it is. */
export function refusalText(error: unknown): string | null {
  if (error instanceof KeycloakUnavailable)
    return "暫時連不到 Keycloak，請稍後再試"
  if (error instanceof MailGroupsUnavailable)
    return "暫時連不到 Google 群組，請稍後再試"
  if (!(error instanceof ApplicationRefusal)) return null
  if (error.code === "cohort_group_missing")
    return `${error.chinese}，已通知 Portal 管理員`
  return error.chinese
}

const fieldName = (key: string) => FIELD_NAMES[key] ?? key

type FromTo = { from?: unknown; to?: unknown }
const isFromTo = (v: unknown): v is FromTo =>
  typeof v === "object" && v !== null && ("from" in v || "to" in v)

/** One line under an event in the timeline, or null. */
export function eventDetail(
  event: Pick<ReviewItem["events"][number], "kind" | "changes">
): string | null {
  const c = event.changes
  if (!c) return null
  switch (event.kind) {
    case "edited":
    case "resubmitted": {
      const keys = Object.keys(c)
      return keys.length ? `改了${keys.map(fieldName).join("、")}` : null
    }
    case "provision_retried": {
      const parts = (["username", "cohort"] as const)
        .map((key) => [key, c[key]] as const)
        .filter((entry): entry is [(typeof entry)[0], FromTo] =>
          isFromTo(entry[1])
        )
        .map(
          ([key, v]) => `${fieldName(key)} ${String(v.from)} → ${String(v.to)}`
        )
      return parts.length ? parts.join("，") : null
    }
    case "provision_step":
    case "provision_failed":
    case "provision_blocked": {
      const step =
        typeof c.step === "string" && c.step in STEP_LABELS
          ? STEP_LABELS[c.step as StepName]
          : null
      const error = typeof c.error === "string" ? c.error : null
      return [step, error].filter(Boolean).join("：") || null
    }
    default:
      return null
  }
}

export type StepState = "done" | "running" | "failed" | "blocked" | "waiting"

/** Every step in order: the completed ones done, the first open one running
 * (failed after a failed attempt, blocked when the run gave up), the rest
 * waiting. */
export function stepRows(
  run: NonNullable<ReviewItem["provisioning"]>
): { name: StepName; label: string; state: StepState; at: string | null }[] {
  const done = new Map(run.steps.map((s) => [s.name, s.completedAt]))
  let current = false
  return STEP_NAMES.map((name) => {
    const at = done.get(name) ?? null
    let state: StepState = "waiting"
    if (at) state = "done"
    else if (!current) {
      current = true
      state = run.blockedAt
        ? "blocked"
        : run.error && run.attempts > 0
          ? "failed"
          : "running"
    }
    return { name, label: STEP_LABELS[name], state, at }
  })
}

/** The fields the form changed, trimmed; a blanked optional field is null. */
export function profilePatch(
  current: ProfileView,
  form: Partial<Record<keyof ProfileView, string | null>>
): Partial<Record<keyof ProfileView, string | null>> {
  const patch: Partial<Record<keyof ProfileView, string | null>> = {}
  for (const { key, optional } of PROFILE_FIELDS) {
    const raw = form[key]
    if (raw === undefined) continue
    const trimmed = (raw ?? "").trim()
    const next = optional && trimmed === "" ? null : trimmed
    if (next !== current[key]) patch[key] = next
  }
  return patch
}

/** The retry's new username or cohort: only a value that differs. */
export function retryChange(
  current: { username: string; cohort: number },
  form: { username?: string; cohort?: string }
): { username?: string; cohort?: number } {
  const change: { username?: string; cohort?: number } = {}
  const username = form.username?.trim()
  if (username && username !== current.username) change.username = username
  const cohort = form.cohort?.trim()
  if (cohort && Number(cohort) !== current.cohort)
    change.cohort = Number(cohort)
  return change
}

const taipei = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** "2026-11-26 14:05", lab time. */
export function taipeiTime(iso: string | Date): string {
  return taipei.format(new Date(iso))
}
