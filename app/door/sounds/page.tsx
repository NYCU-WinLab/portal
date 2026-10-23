import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { runAction } from "@/lib/actions/define"
import { listDoorSounds } from "@/lib/actions/door-sounds"
import { requireActor } from "@/lib/auth/session"
import { SOUND_MAX_SECONDS } from "@/lib/door-greeting"

import { doorNav, doorPage } from "../nav"
import { SoundList, UploadSound } from "./sound-list"

export const dynamic = "force-dynamic"

export default async function DoorSoundsPage() {
  const actor = await requireActor("/door/sounds")
  const { sounds, can_edit_all } = await runAction(listDoorSounds, actor, {})
  const mine = sounds.filter((sound) => sound.onMyPlaylist)
  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="音效池"
          actions={<UploadSound maxSeconds={SOUND_MAX_SECONDS} />}
        />
        <Focus>
          <FocusLabel>你開門時</FocusLabel>
          <FocusTitle>
            {mine.length === 0 ? (
              "播實驗室預設音效"
            ) : mine.length === 1 ? (
              <>
                都播 <FocusHighlight>{mine[0].label}</FocusHighlight>
              </>
            ) : (
              <>
                從{" "}
                <FocusHighlight>
                  <NumberTicker value={mine.length} />
                </FocusHighlight>{" "}
                個裡隨機播
              </>
            )}
          </FocusTitle>
        </Focus>
        <SoundList
          sounds={sounds}
          canEditAll={can_edit_all}
          maxSeconds={SOUND_MAX_SECONDS}
        />
      </div>
    </PortalShell>
  )
}
