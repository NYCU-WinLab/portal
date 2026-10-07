import * as React from "react"

// A page that only says what happened and what to do next: not found, an
// error, no access, signed out. Put it in app-shell's spotlight layout.
// Say it in Chinese, as a sentence: "找不到這個頁面", "這個頁面出了問題",
// "你沒有這個頁面的權限".
function StatusPage({
  title,
  description,
  action,
}: {
  title: string
  /** Why it happened, in one sentence. */
  description: React.ReactNode
  /** The way out: 回到首頁, 重試, 登入. */
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="status-page"
      className="flex flex-col items-center gap-12 text-center"
    >
      <header className="flex flex-col items-center gap-2">
        <h1 className="text-title font-medium">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </header>
      {action}
    </div>
  )
}

export { StatusPage }
