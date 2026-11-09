import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { listLikedSongs } from "@/lib/actions/music"
import { requireActor } from "@/lib/auth/session"

import { AddButtons } from "../add-songs"
import { LikeButton } from "../like-button"
import { Cover, length } from "../song"
import { musicNav, musicPage } from "../nav"

export const dynamic = "force-dynamic"

export default async function Liked() {
  const actor = await requireActor("/music/liked")
  const { songs } = await runAction(listLikedSongs, actor, { limit: 500 })
  return (
    <PortalShell page={musicPage} nav={musicNav}>
      <div className="flex flex-col gap-8">
        <PageHeader title="我的愛心歌曲" />
        {songs.length ? (
          <ol className="flex flex-col">
            {songs.map(({ track }) => (
              <li
                key={track.videoId}
                className="flex items-center gap-4 border-b border-border py-3"
              >
                <Cover src={track.thumbnail} className="size-12" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{track.title}</span>
                  <span className="truncate text-muted-foreground">
                    {[track.artist, length(track.durationS)]
                      .filter(Boolean)
                      .join("，")}
                  </span>
                </div>
                <LikeButton videoId={track.videoId} liked />
                <AddButtons videoId={track.videoId} />
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            noun="愛心歌曲"
            action={
              <p className="text-muted-foreground">
                在佇列、正在播或播過的歌按愛心，就會收在這裡。
              </p>
            }
          />
        )}
      </div>
    </PortalShell>
  )
}
