import Link from "next/link"

import { adminAppsOf, type Gated, visibleTo } from "@/lib/actions/authz"
import type { Actor } from "@/lib/actions/define"
import { cn } from "@/lib/utils"

/** The pages of one corner link, such as 音效, 問候語 and 語音 under 聲音.
 * A tab with admin shows only to that app's admins; a group left with one
 * tab shows no row. */
export async function DoorTabs({
  actor,
  tabs,
  current,
}: {
  actor: Actor
  tabs: ({ label: string; href: string } & Gated)[]
  current: string
}) {
  const shown = tabs.some((tab) => tab.admin)
    ? visibleTo(await adminAppsOf(actor), tabs)
    : tabs
  if (shown.length < 2) return null
  return (
    <nav aria-label="分頁" className="flex gap-4">
      {shown.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          prefetch
          aria-current={tab.href === current ? "page" : undefined}
          className={cn(
            "transition-colors duration-state hover:text-foreground",
            tab.href === current ? "text-foreground" : "text-muted-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
