import { notFound } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { requireActor } from "@/lib/auth/session"
import { GAME_META } from "@/lib/games/constants"
import type { GameType } from "@/lib/games/types"

import { GamePage } from "../game-page"
import { gamesPage } from "../nav"

export const dynamic = "force-dynamic"

export default async function Game({
  params,
}: {
  params: Promise<{ game: string }>
}) {
  const { game } = await params
  if (!(game in GAME_META)) notFound()
  await requireActor(`/games/${game}`)
  const meta = GAME_META[game as GameType]
  return (
    <PortalShell page={gamesPage} layout="wide">
      <div className="flex flex-col gap-8">
        <PageHeader title={meta.title} />
        <GamePage gameType={game as GameType} />
      </div>
    </PortalShell>
  )
}
