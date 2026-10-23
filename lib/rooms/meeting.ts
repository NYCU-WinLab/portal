// The Teams topic, GitLab epics and deliverables, and the calendar invite a
// booking mails out.

/** Who an invite goes to; Keycloak group members need no portal account. */
export type Attendee = { name: string; email: string; username?: string }

// The topic names the recording file, which is later sorted into Nextcloud
// by its [prefix]: an ASCII id (the group's slug, or a member's username),
// joined here only, so typed text can never pose as another project's.
const UNSAFE = /[\\/:*?"<>|[\]]/g

export const DEFAULT_TOPIC = "meeting"

export const forFilename = (value: string) =>
  value.replace(UNSAFE, " ").replace(/\s+/g, " ").trim()

/** The group, else the first attendee with a username; null for neither. */
export function topicPrefix(
  groupName: string | null | undefined,
  attendees: Attendee[]
) {
  const raw = groupName ?? attendees.find((a) => a.username)?.username
  return (raw && forFilename(raw)) || null
}

export function composeTopic(prefix: string | null, suffix: string) {
  const clean = forFilename(suffix) || DEFAULT_TOPIC
  return prefix ? `[${prefix}]-${clean}` : clean
}

/** A topic split back into its [prefix] and the title after it. */
export function splitTopic(topic: string) {
  const match = /^\[([^\]]+)\]-(.*)$/.exec(topic)
  return match
    ? { prefix: match[1], title: match[2] }
    : { prefix: null, title: topic }
}

/** The lab's advisor; project groups list students only. */
export const ADVISOR_USERNAME = "cctseng"

/** Adds people to a list, once per email. */
export function mergeAttendees(current: Attendee[], more: Attendee[]) {
  const seen = new Set(current.map((a) => a.email.toLowerCase()))
  const out = [...current]
  for (const person of more) {
    const key = person.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(person)
  }
  return out
}

// GitLab's scoped labels for what a meeting owes, on every lab project.
export const DELIVERABLES = [
  { value: "Deliverable::Presentation", label: "投影片" },
  { value: "Deliverable::Report", label: "報告" },
  { value: "Deliverable::Code", label: "程式" },
  { value: "Deliverable::Demo", label: "Demo" },
] as const

/** Known deliverable labels only, once each, in the canonical order. */
export function deliverablesOf(labels: readonly string[]) {
  const present = new Set(labels)
  return DELIVERABLES.map((d) => d.value).filter((value) => present.has(value))
}

export const deliverableLabel = (value: string) =>
  DELIVERABLES.find((d) => d.value === value)?.label ?? value

/**
 * An epic is a Sync container unless it carries Meeting::Track; a tracked
 * epic with a winlab:review marker is a Report, which owes what its
 * iteration's issues owe. Sync containers owe nothing themselves.
 */
export type EpicKind = "sync" | "meeting" | "report"

export type Epic = {
  iid: number
  title: string
  description: string | null
  url: string | null
  kind: EpicKind
  /** A Report's iteration; null when its marker cannot name one. */
  reviewIteration: number | null
}

const REVIEW_MARKER = /<!--\s*winlab:review(?=\s|-->)([^>]*)-->/g
const ITERATION = /\biteration\s*=\s*"([1-9]\d*)"/g

export function readEpic(raw: unknown): Epic | null {
  if (typeof raw !== "object" || raw === null) return null
  const row = raw as Record<string, unknown>
  const iid = Number(row.iid)
  const title = typeof row.title === "string" ? row.title.trim() : ""
  if (!Number.isSafeInteger(iid) || iid < 1 || !title) return null
  const description =
    typeof row.description === "string" && row.description.trim()
      ? row.description
      : null
  const labels = Array.isArray(row.labels) ? row.labels : []
  let kind: EpicKind = "sync"
  let reviewIteration: number | null = null
  if (labels.includes("Meeting::Track")) {
    const markers = [...(description ?? "").matchAll(REVIEW_MARKER)]
    kind = markers.length ? "report" : "meeting"
    if (markers.length === 1) {
      const iterations = [...markers[0][1].matchAll(ITERATION)]
      if (iterations.length === 1) reviewIteration = Number(iterations[0][1])
    }
  }
  return {
    iid,
    title,
    description,
    url: typeof row.web_url === "string" ? row.web_url : null,
    kind,
    reviewIteration,
  }
}

/** `winlab/x/tasa&4`, a URL to the epic, `&4` or `4` (in groupPath), as
 * its iid; null when it names another group or nothing. */
export function epicIid(ref: string, groupPath: string) {
  const value = ref.trim()
  const url = /\/groups\/(.+?)\/-\/epics\/(\d+)/.exec(value)
  const full = /^(.+)&(\d+)$/.exec(value)
  const named = url ?? full
  if (named) return named[1] === groupPath ? Number(named[2]) : null
  const bare = /^&?(\d+)$/.exec(value)
  return bare ? Number(bare[1]) : null
}

// RFC 5545: escape TEXT, fold lines at 75 octets without splitting a
// character (titles are mostly Chinese, 3 bytes each).
const icsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")

// A parameter value is quoted, and may hold no quote or line break.
const icsParam = (value: string) => `"${value.replace(/["\r\n]/g, " ")}"`

function fold(line: string) {
  const bytes = new TextEncoder().encode(line)
  const decode = (from: number, to: number) =>
    new TextDecoder().decode(bytes.subarray(from, to))
  const parts: string[] = []
  let start = 0
  let limit = 75
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length)
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80)
      end--
    parts.push(decode(start, end))
    start = end
    limit = 74
  }
  return parts.join("\r\n ")
}

const icsTime = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "")

/**
 * A calendar invite: with METHOD:REQUEST mail clients show Yes/No buttons
 * and accepting files it in the member's own calendar. The uid stays the
 * same for a booking so a later CANCEL (with a higher sequence) removes it.
 */
export function calendarInvite(event: {
  uid: string
  method: "REQUEST" | "CANCEL"
  sequence: number
  title: string
  location: string
  start: string
  end: string
  organizer: { name: string; email: string }
  attendees: Attendee[]
  /** Asks each attendee to answer; off for a mailing list. */
  rsvp?: boolean
  joinUrl: string | null
}) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WinLab//portal.winlab.tw//ZH-TW",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.method}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${icsTime(new Date().toISOString())}`,
    `DTSTART:${icsTime(event.start)}`,
    `DTEND:${icsTime(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    `LOCATION:${icsText(event.location)}`,
    `ORGANIZER;CN=${icsParam(event.organizer.name)}:mailto:${event.organizer.email}`,
    ...event.attendees.map(
      (a) =>
        `ATTENDEE;CN=${icsParam(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=${event.rsvp === false ? "FALSE" : "TRUE"}:mailto:${a.email}`
    ),
    `STATUS:${event.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    ...(event.joinUrl
      ? [
          `DESCRIPTION:${icsText(`線上會議：${event.joinUrl}`)}`,
          `URL:${event.joinUrl}`,
        ]
      : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ]
  return lines.map(fold).join("\r\n")
}

/** What a pipeline failure code means for the member who booked. */
export const MEETING_FAILURES: Record<string, string> = {
  INVALID_REQUEST: "Portal 送出的欄位不完整",
  LOGIN_FAILED: "會議服務帳號登入失敗，密碼可能過期",
  MFA_REQUIRED: "會議服務帳號要求 MFA，需要人工處理",
  INVALID_PAYLOAD: "Teams 拒絕了這個會議內容",
  CREATE_FAILED: "Teams 建立會議失敗",
  OPTIONS_FAILED: "會議已建立，但自動錄影沒有套用",
  CANCEL_FAILED: "Teams 取消會議失敗",
  INVALID_JOIN_URL: "pipeline 回傳的不是 Teams 連結",
  UNEXPECTED_RESPONSE: "Teams 的回應缺少必要欄位",
  NO_CALLBACK: "pipeline 沒有在時限內回報",
  TRIGGER_FAILED: "Portal 連不上 GitLab，pipeline 沒有啟動",
}
