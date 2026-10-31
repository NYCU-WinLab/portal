// Dates and times for /rooms. Days are YYYY-MM-DD Asia/Taipei calendar days
// and times HH:MM on a 30-minute grid from 08:00 to 22:00, the slice of the
// day the page draws and the department lends rooms in.

export const SLOT_MINUTES = 30
export const DAY_START_HOUR = 8
export const DAY_END_HOUR = 22
/** Durations offered as one tap. */
export const DURATION_PRESETS = [30, 60, 90, 120, 150, 180]
/** How long a standing meeting may run. */
export const SERIES_MIN_MINUTES = 30
export const SERIES_MAX_MINUTES = 300

const DAY_MS = 86_400_000
const taipeiDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

export const todayInTaipei = () => taipeiDay.format(new Date())

/** These strings are calendar days already; UTC midnight keeps the
 * arithmetic on whole days. */
const utc = (day: string) => new Date(`${day}T00:00:00Z`)

export function addDays(day: string, n: number) {
  return new Date(utc(day).getTime() + n * DAY_MS).toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) =>
  Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS)

/** 0 = Sunday. */
export const weekdayOf = (day: string) => utc(day).getUTCDay()

/** A real calendar day: Date rolls 11-31 over into December. */
export function isCalendarDay(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    utc(value).toISOString().slice(0, 10) === value
  )
}

/** Minutes since midnight for a strict HH:MM, else null. */
export function minutesOf(time: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function clock(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

/** HH:MM plus minutes, or null past 23:59. */
export function addMinutes(time: string, minutes: number) {
  const start = minutesOf(time)
  if (start === null || start + minutes >= 24 * 60) return null
  return clock(start + minutes)
}

/** An online-only meeting runs at most this long. */
export const ONLINE_MAX_MINUTES = 300
/** An online-only meeting is booked at most this many days ahead. */
export const ONLINE_AHEAD_DAYS = 90

/** Like addMinutes, but a meeting may end at midnight, "24:00". */
export function endAfter(time: string, minutes: number) {
  const start = minutesOf(time)
  if (start === null || start + minutes > 24 * 60) return null
  return start + minutes === 24 * 60 ? "24:00" : clock(start + minutes)
}

/** Minutes since midnight of an end time, "24:00" included. */
const endMinutesOf = (time: string) =>
  time === "24:00" ? 24 * 60 : minutesOf(time)

/**
 * Why start..end is not a span for an online-only meeting, or null: any
 * time of day on the 30-minute grid, ending by midnight, 30 to 300 minutes.
 */
export function onlineSpanProblem(start: string, end: string) {
  const from = minutesOf(start)
  const to = endMinutesOf(end)
  if (from === null || to === null) return "時間格式要是 HH:MM"
  if (from % SLOT_MINUTES || to % SLOT_MINUTES)
    return `時間要對齊 ${SLOT_MINUTES} 分鐘的格子`
  if (to <= from) return "結束時間要晚於開始時間，最晚 24:00"
  if (to - from > ONLINE_MAX_MINUTES)
    return `線上會議最長 ${ONLINE_MAX_MINUTES} 分鐘`
  return null
}

/** Whether two spans on the same day overlap; ends may be "24:00". */
export function spansOverlap(
  a: { start: string; end: string },
  b: { start: string; end: string }
) {
  const [as, ae, bs, be] = [
    minutesOf(a.start),
    endMinutesOf(a.end),
    minutesOf(b.start),
    endMinutesOf(b.end),
  ]
  if (as === null || ae === null || bs === null || be === null) return false
  return as < be && bs < ae
}

/** The instant a Taipei wall-clock time is, as ISO 8601 UTC. */
export const taipeiIso = (day: string, time: string) =>
  new Date(`${day}T${time}:00+08:00`).toISOString()

/** 2026-08-18T09:30:00+08:00, what GitLab is handed. */
export const taipeiOffsetIso = (day: string, time: string) =>
  `${day}T${time}:00+08:00`

/** "10/23（四）". */
export function dayLabel(day: string) {
  const [, month, date] = day.split("-")
  const weekday = "日一二三四五六"[weekdayOf(day)]
  return `${month}/${date}（${weekday}）`
}

/** Every slot start the day offers: 08:00 … 21:30. */
export function slotStarts() {
  const count = ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_MINUTES
  return Array.from({ length: count }, (_, i) =>
    clock(DAY_START_HOUR * 60 + i * SLOT_MINUTES)
  )
}

/** Why start..end is not a bookable span, or null when it is. */
export function spanProblem(start: string, end: string) {
  const from = minutesOf(start)
  const to = minutesOf(end)
  if (from === null || to === null) return "時間格式要是 HH:MM"
  if (from % SLOT_MINUTES || to % SLOT_MINUTES)
    return `時間要對齊 ${SLOT_MINUTES} 分鐘的格子`
  if (from < DAY_START_HOUR * 60 || to > DAY_END_HOUR * 60)
    return `只能借 ${clock(DAY_START_HOUR * 60)} 到 ${clock(DAY_END_HOUR * 60)}`
  if (to <= from) return "結束時間要晚於開始時間"
  return null
}

export type Recurrence = {
  weekday: number
  /** 1 every week, 2 every other week. */
  intervalWeeks: number
  /** A day the series is known to meet on. */
  anchorDate: string
}

export function occursOn(rule: Recurrence, day: string) {
  if (weekdayOf(day) !== rule.weekday) return false
  // Floored, so days before the anchor keep the same alternation.
  const weeks = Math.floor(daysBetween(rule.anchorDate, day) / 7)
  return (
    ((weeks % rule.intervalWeeks) + rule.intervalWeeks) % rule.intervalWeeks ===
    0
  )
}

/** The days in [from, to] the series meets on. */
export function occurrencesBetween(rule: Recurrence, from: string, to: string) {
  const days: string[] = []
  for (let i = 0; i <= daysBetween(from, to); i++) {
    const day = addDays(from, i)
    if (occursOn(rule, day)) days.push(day)
  }
  return days
}

/** The first day on or after from that the series meets on. */
export function nextOccurrence(rule: Recurrence, from: string) {
  return (
    occurrencesBetween(rule, from, addDays(from, 7 * rule.intervalWeeks))[0] ??
    null
  )
}

/** The first day on or after from that falls on weekday. */
export const nextWeekday = (from: string, weekday: number) =>
  addDays(from, (weekday - weekdayOf(from) + 7) % 7)
