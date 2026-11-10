// Release notes grouped by day (Asia/Taipei), newest first. Each note is
// one change per line, with the commit it shipped in, as in the bottom-left
// build. Shared by the release dialog and /changelog.

export type ReleaseNote = {
  slug: string
  body: string
  sha: string
  publishedAt: Date | string
}

const day = (date: Date | string) =>
  new Date(date).toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  })

export function ReleaseNotes({ notes }: { notes: ReleaseNote[] }) {
  const days = new Map<string, ReleaseNote[]>()
  for (const note of notes) {
    const key = day(note.publishedAt)
    days.set(key, [...(days.get(key) ?? []), note])
  }
  return (
    <div className="flex flex-col gap-6">
      {[...days].map(([date, list]) => (
        <section key={date} className="flex flex-col gap-2">
          <h3 className="text-muted-foreground">{date}</h3>
          <ul className="flex flex-col gap-2">
            {list.flatMap((note) =>
              note.body
                .split("\n")
                .map((line) => line.replace(/^[-*]\s*/, "").trim())
                .filter(Boolean)
                .map((line, i) => (
                  <li
                    key={`${note.slug}-${i}`}
                    className="flex items-baseline gap-4"
                  >
                    <span className="min-w-0 flex-1">{line}</span>
                    <span className="shrink-0 font-mono text-muted-foreground">
                      {note.sha}
                    </span>
                  </li>
                ))
            )}
          </ul>
        </section>
      ))}
    </div>
  )
}
