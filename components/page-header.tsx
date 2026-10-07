import * as React from "react"

type HeaderProps = {
  title: React.ReactNode
  /** One line under the title saying what the page holds. */
  description?: React.ReactNode
  /** Buttons that act on this page's content, such as 新增. Navigation goes
   * in the app shell's corners, not here. */
  actions?: React.ReactNode
}

// The top of a page: its title and what it holds on the left, the page's
// own actions on the right. On a phone the actions drop under the title.
function PageHeader({ title, description, actions }: HeaderProps) {
  return (
    <header
      data-slot="page-header"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h1 className="text-title font-medium">{title}</h1>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-3">{actions}</div>}
    </header>
  )
}

// A section title inside a page, one step below the page title by weight.
function SectionHeader({ title, description, actions }: HeaderProps) {
  return (
    <div
      data-slot="section-header"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-3">{actions}</div>}
    </div>
  )
}

export { PageHeader, SectionHeader }
