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

/** "- A\n* B\n1. C" as lines, markers and blanks dropped, ≤ 200 chars each. */
export function agendaLines(text: string | null): string[] {
  if (!text) return []
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").trim())
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
