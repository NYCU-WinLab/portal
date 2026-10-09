// NYCU semesters as the lab meeting schedule uses them: the first runs
// August 1 to January 31, the second February 1 to July 31. Dates are
// "YYYY-MM-DD" strings, compared as strings.

export type Semester = { start: string; end: string; label: string }

/** The semester a date falls in; label is the ROC year and 上 / 下. */
export function semesterOf(isoDate: string): Semester {
  const [year, month] = isoDate.split("-").map(Number)
  if (month >= 8)
    return {
      start: `${year}-08-01`,
      end: `${year + 1}-01-31`,
      label: `${year - 1911} 上`,
    }
  if (month === 1)
    return {
      start: `${year - 1}-08-01`,
      end: `${year}-01-31`,
      label: `${year - 1912} 上`,
    }
  return {
    start: `${year}-02-01`,
    end: `${year}-07-31`,
    label: `${year - 1912} 下`,
  }
}

/** isoDate plus days, as "YYYY-MM-DD". */
export function addDays(isoDate: string, days: number) {
  const day = new Date(`${isoDate}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

/** Days from one date to another. */
function daysBetween(from: string, to: string) {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  )
}

/**
 * What the lab calls the week of date: 第 n 週 counted from its semester's
 * first week of classes, or the break it falls in before or after them.
 * null when no semester has been set up for it.
 */
export function weekLabel(
  date: string,
  semesters: { start: string; weeks: number }[]
) {
  const window = semesterOf(date)
  const semester = semesters.find(
    ({ start }) => start >= window.start && start <= window.end
  )
  if (!semester) return null
  const week = Math.floor(daysBetween(semester.start, date) / 7) + 1
  const autumn = window.start.endsWith("-08-01")
  if (week < 1) return autumn ? "暑假" : "寒假"
  if (week > semester.weeks) return autumn ? "寒假" : "暑假"
  return `第 ${week} 週`
}
