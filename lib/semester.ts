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
