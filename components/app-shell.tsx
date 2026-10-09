"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

// Every corner item has a tip, required so none is forgotten. It says what
// the label leaves out (where a link goes, what a page holds, whose account
// it is); it never repeats the label.
type Crumb = { label: string; href: string; tip: string }
type NavItem = { label: string; href: string; tip: string }

// The chrome of every WinLab app is its four corners. By default each corner
// has one job, filled from the props below; an app that needs something else
// in a corner passes it in `corners`, built from CornerLink and CornerTip so
// it keeps the corner's look.
//   top left     where you are: breadcrumb back to the lab and the app
//   top right    where you can go: this app's pages, then the account (登入
//                when signed out, the member's name when signed in)
//   bottom left  which build: the commit this build came from
//   bottom right the copyright year; the tip names the owner
// Every item can carry a tip, opening toward the page and lined up with the
// corner's outer edge so it never leaves the viewport.
// Three page layouts:
//   column     read top to bottom: home, lists, tables, long forms
//   spotlight  one thing, centered between the corners: a detail, sign-in,
//              a result, an empty state; taller content scrolls as a column
//   wide       a grid that needs every pixel, such as a two-week timetable:
//              the full width between the corners' outer edges
function AppShell({
  breadcrumb = [],
  nav = [],
  account,
  layout = "column",
  corners,
  children,
}: {
  breadcrumb?: Crumb[]
  nav?: NavItem[]
  /** Last in the top right: { label: "登入", href: "/sign-in" } signed out,
   * the member's name linking to their page signed in. */
  account?: NavItem
  corners?: Partial<
    Record<
      "topLeft" | "topRight" | "bottomLeft" | "bottomRight",
      React.ReactNode
    >
  >
  layout?: "column" | "spotlight" | "wide"
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const matches = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`)
  // Of nav links that nest (/meetings, /meetings/papers), only the deepest
  // match is the current page.
  const navCurrent = nav
    ?.map((item) => item.href)
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0]
  const isCurrent = (href: string) =>
    nav?.some((item) => item.href === href)
      ? href === navCurrent
      : matches(href)

  return (
    <TooltipProvider>
      {/* Content scrolling under the corners fades into frosted glass. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-16 mask-b-from-0% backdrop-blur-md"
      />
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 h-16 mask-t-from-0% backdrop-blur-md"
      />

      <header className="fixed top-6 left-6 z-50 flex items-center gap-4">
        {corners?.topLeft ?? (
          <nav aria-label="位置" className="flex items-center gap-2">
            {breadcrumb.map((crumb, index) => {
              const last = index === breadcrumb.length - 1
              return (
                <React.Fragment key={crumb.href}>
                  {index > 0 && (
                    <span aria-hidden className="text-muted-foreground">
                      /
                    </span>
                  )}
                  <CornerTip tip={crumb.tip} corner="top-left">
                    <Link
                      href={crumb.href}
                      aria-current={last ? "page" : undefined}
                      className={cn(cornerLink, last && "text-foreground")}
                    >
                      {crumb.label}
                    </Link>
                  </CornerTip>
                </React.Fragment>
              )
            })}
          </nav>
        )}
      </header>

      <div className="fixed top-6 right-6 z-50 flex items-center gap-4">
        {corners?.topRight ??
          ((nav.length > 0 || account) && (
            <nav aria-label="頁面" className="flex items-center gap-4">
              {[...nav, ...(account ? [account] : [])].map((item) => (
                <CornerTip key={item.href} tip={item.tip} corner="top-right">
                  <Link
                    href={item.href}
                    aria-current={isCurrent(item.href) ? "page" : undefined}
                    className={cn(
                      cornerLink,
                      isCurrent(item.href) && "text-foreground"
                    )}
                  >
                    {item.label}
                  </Link>
                </CornerTip>
              ))}
            </nav>
          ))}
      </div>

      <div className="fixed bottom-6 left-6 z-50 flex items-center gap-4">
        {corners?.bottomLeft ?? <BuildVersion />}
      </div>

      <div className="fixed right-6 bottom-6 z-50 flex items-center gap-4">
        {corners?.bottomRight ?? (
          <CornerTip tip="NYCU WinLab" corner="bottom-right">
            <span tabIndex={0} className={cn(cornerLink, "cursor-default")}>
              © {new Date().getFullYear()}
            </span>
          </CornerTip>
        )}
      </div>

      {layout === "spotlight" ? (
        <main className="flex min-h-svh w-full items-center justify-center px-6 py-24">
          <div className="w-full max-w-2xl">{children}</div>
        </main>
      ) : layout === "wide" ? (
        <main className="w-full px-6 pt-24 pb-24">{children}</main>
      ) : (
        <main className="mx-auto w-full max-w-4xl px-6 pt-24 pb-24">
          {children}
        </main>
      )}
    </TooltipProvider>
  )
}

type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right"

function CornerTip({
  tip,
  corner,
  children,
}: {
  tip?: string
  corner: Corner
  children: React.ReactElement
}) {
  if (!tip) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent
        side={corner.startsWith("top") ? "bottom" : "top"}
        align={corner.endsWith("left") ? "start" : "end"}
      >
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}

const cornerLink =
  "relative inline-flex h-6 items-center text-muted-foreground transition-colors duration-state outline-none after:absolute after:-inset-2 hover:text-foreground focus-visible:text-foreground"

// Which build is running: the short commit, linking to the CD run that built
// it, with the build time as its tip. CD sets these at build time; without
// them (local dev) the corner says "dev".
function BuildVersion() {
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA
  const time = process.env.NEXT_PUBLIC_BUILD_TIME
  const url = process.env.NEXT_PUBLIC_BUILD_URL
  if (!sha) {
    return <span className={cornerLink}>dev</span>
  }
  const label = <span className="font-mono">{sha}</span>
  return (
    <CornerTip tip={time ? `建置於 ${time}` : undefined} corner="bottom-left">
      {url ? (
        <a href={url} className={cornerLink}>
          {label}
        </a>
      ) : (
        <span tabIndex={0} className={cn(cornerLink, "cursor-default")}>
          {label}
        </span>
      )}
    </CornerTip>
  )
}

// A link styled for a corner, for custom corner content.
function CornerLink({
  className,
  ...props
}: React.ComponentProps<typeof Link>) {
  return <Link className={cn(cornerLink, className)} {...props} />
}

export { AppShell, CornerLink, CornerTip }
