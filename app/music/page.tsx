import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listActivity, listQueue, nowPlaying } from "@/lib/actions/music"
import { requireActor } from "@/lib/auth/session"

import { Activity } from "./activity"
import { AddSongs } from "./add-songs"
import { NowPlaying } from "./now-playing"
import { Queue } from "./queue"
import { musicNav, musicPage } from "./nav"

export const dynamic = "force-dynamic"

export default async function MusicPage() {
  const actor = await requireActor("/music")
  const [playing, queue, activity] = await Promise.all([
    runAction(nowPlaying, actor, {}),
    runAction(listQueue, actor, {}),
    runAction(listActivity, actor, { limit: 20 }),
  ])
  return (
    <PortalShell page={musicPage} nav={musicNav}>
      <div className="flex flex-col gap-12">
        <NowPlaying playing={playing} />
        <AddSongs />
        <Queue items={queue.items} />
        <Activity activities={activity.activities} />
      </div>
    </PortalShell>
  )
}
