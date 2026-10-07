// Meeting dates are calendar days in Taipei (UTC+8, no DST), kept as
// "YYYY-MM-DD" strings and read in UTC so the server's timezone never
// shifts them.

/** How many Mondays ahead a member can sign up for, today included. */
export const LEAVE_WINDOW = 8

export function taipeiToday(now: Date = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** The Mondays a member can sign up for: today if Monday, then weekly. */
export function upcomingMondays(today: string = taipeiToday()) {
  const start = new Date(`${today}T00:00:00Z`)
  const offset = (8 - start.getUTCDay()) % 7
  return Array.from({ length: LEAVE_WINDOW }, (_, week) => {
    const day = new Date(start)
    day.setUTCDate(start.getUTCDate() + offset + week * 7)
    return day.toISOString().slice(0, 10)
  })
}

/** 2026-10-13 → "10 月 13 日". */
export function dateLabel(isoDate: string) {
  const [, month, day] = isoDate.split("-").map(Number)
  return `${month} 月 ${day} 日`
}
