import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { runAction } from "@/lib/actions/define"
import { listDoorSoundRules } from "@/lib/actions/door-sound-rules"
import { listDoorSounds } from "@/lib/actions/door-sounds"
import { requireActor } from "@/lib/auth/session"
import { SOUND_MAX_SECONDS } from "@/lib/door-greeting"

import { doorNav, doorPage } from "../nav"
import { AddRule, RuleList } from "../schedule/rule-list"
import { SoundList, UploadSound } from "./sound-list"

export const dynamic = "force-dynamic"

export default async function DoorSoundsPage() {
  const actor = await requireActor("/door/sounds")
  const [{ sounds, can_edit_all }, { rules, now, can_edit }] =
    await Promise.all([
      runAction(listDoorSounds, actor, {}),
      runAction(listDoorSoundRules, actor, {}),
    ])
  const pool = sounds.map(({ id, label }) => ({ id, label }))
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
              "播實驗室排程或預設音效"
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
        {/* The lab's sounds by the time of day, for members with no playlist
            of their own. Everyone reads it; door admins change it. */}
        <section className="flex flex-col gap-2">
          <SectionHeader
            title="排程"
            actions={can_edit && <AddRule sounds={pool} />}
          />
          <RuleList rules={rules} now={now} sounds={pool} editable={can_edit} />
        </section>
      </div>
    </PortalShell>
  )
}
