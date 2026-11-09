import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusMeta,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { runAction } from "@/lib/actions/define"
import { listDoorSoundRules } from "@/lib/actions/door-sound-rules"
import { listDoorSounds } from "@/lib/actions/door-sounds"
import { requireActor } from "@/lib/auth/session"

import { doorNav, doorPage, soundTabs } from "../nav"
import { DoorTabs } from "../tabs"
import { AddRule, RuleList } from "./rule-list"

export const dynamic = "force-dynamic"

// The lab's door sounds by the time of day. Everyone reads it; door admins
// change it. A member's own playlist always wins over it.
export default async function DoorSchedulePage() {
  const actor = await requireActor("/door/schedule")
  const [{ rules, now, now_sounds, now_from, can_edit }, { sounds }] =
    await Promise.all([
      runAction(listDoorSoundRules, actor, {}),
      runAction(listDoorSounds, actor, {}),
    ])
  const pool = sounds.map(({ id, label }) => ({ id, label }))
  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <div className="flex flex-col gap-12">
        <DoorTabs actor={actor} tabs={soundTabs} current="/door/schedule" />
        <PageHeader
          title="音效排程"
          actions={can_edit && <AddRule sounds={pool} />}
        />
        <Focus>
          <FocusLabel>現在沒設自己音效的人開門</FocusLabel>
          <FocusTitle>
            {now_sounds.length === 0 ? (
              "播門口內建音效"
            ) : now_sounds.length === 1 ? (
              <>
                播 <FocusHighlight>{now_sounds[0].label}</FocusHighlight>
              </>
            ) : (
              <>
                從{" "}
                <FocusHighlight>
                  <NumberTicker value={now_sounds.length} />
                </FocusHighlight>{" "}
                個裡隨機播
              </>
            )}
          </FocusTitle>
          <FocusMeta>
            <span>
              {now_from === "schedule" ? "依排程" : "沒有排程生效，播預設音效"}
              。自己清單有音效的人照自己的清單播。
            </span>
          </FocusMeta>
        </Focus>
        <RuleList rules={rules} now={now} sounds={pool} editable={can_edit} />
      </div>
    </PortalShell>
  )
}
