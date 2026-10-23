import Link from "next/link"

import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { requireActor } from "@/lib/auth/session"
import { GAME_META, GAME_ORDER } from "@/lib/games/constants"

import { gamesPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function GamesPage() {
  await requireActor("/games")
  return (
    <PortalShell page={gamesPage}>
      <div className="flex flex-col gap-12">
        <PageHeader title="小遊戲" />
        <ul className="flex stagger-rise flex-col">
          {GAME_ORDER.map((slug) => (
            <li key={slug} className="border-b border-border">
              <Link
                prefetch
                href={`/games/${slug}`}
                className="flex min-h-14 items-center gap-4 py-2 transition-colors duration-state hover:text-muted-foreground"
              >
                <span className="w-28 shrink-0 font-medium">
                  {GAME_META[slug].title}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {GAME_META[slug].description}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </PortalShell>
  )
}
