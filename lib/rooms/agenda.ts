// A booking's agenda as meet shows it: the booking's own lines first, then
// the epic's open child issues with their links. Pure; the issues are read
// by the caller.

/** At most this many items reach meet. */
export const AGENDA_MAX = 30

export type AgendaItem = {
  text: string
  source: "booking" | "issue"
  url?: string
}

// "- A", "* B", "1. C", "2) D", "3、E"; not "1.5 倍".
const MARKER = /^(?:[-*\u2022]\s+|\d+[.)、]\s*(?!\d))/

/**
 * The agenda field as items, ≤ 200 chars each. People also write notes in
 * it (where to meet, a link, a notice), so when any line is a list item
 * ("- A", "* B", "1. C"), only the list items at the left margin count and
 * the other lines are notes. A field with no list is one item per line.
 * HTML comments and Markdown headings are never items.
 */
export function agendaLines(text: string | null): string[] {
  if (!text) return []
  const lines = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n")
    .filter((line) => line.trim() && !/^\s*#{1,6}\s/.test(line))
  const listed = lines.filter((line) => MARKER.test(line))
  return (listed.length > 0 ? listed : lines)
    .map((line) => line.trim().replace(MARKER, "").trim())
    .filter(Boolean)
    .map((line) => line.slice(0, 200))
}

export function agendaItems(
  agenda: string | null,
  issues: { title: string; url: string | null }[]
): AgendaItem[] {
  return [
    ...agendaLines(agenda).map((text) => ({
      text,
      source: "booking" as const,
    })),
    ...issues
      .filter((issue) => issue.title)
      .map((issue) => ({
        text: issue.title.slice(0, 200),
        source: "issue" as const,
        ...(issue.url ? { url: issue.url } : {}),
      })),
  ].slice(0, AGENDA_MAX)
}
