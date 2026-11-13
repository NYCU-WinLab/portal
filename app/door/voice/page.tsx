import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { ProgressRefresh } from "@/components/live-refresh"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDoorVoiceClips } from "@/lib/actions/door-phrases"
import { requireActor } from "@/lib/auth/session"

import { doorNav, doorPage, greetingTabs } from "../nav"
import { DoorTabs } from "../tabs"
import { ClipList } from "./clip-list"

export const dynamic = "force-dynamic"

export default async function DoorVoicePage() {
  const actor = await requireActor("/door/voice")
  await requireAdminPage(actor, "door")
  const { clips, missing, job } = await runAction(listDoorVoiceClips, actor, {})
  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <ProgressRefresh topic="door_voice" />
      <div className="flex flex-col gap-12">
        <DoorTabs actor={actor} tabs={greetingTabs} current="/door/voice" />
        <PageHeader title="語音" />
        <Focus>
          <FocusLabel>
            {missing.length === 0
              ? "老師的聲音"
              : !job.online
                ? "老師的聲音，錄音暫停"
                : job.text
                  ? `正在錄「${job.text}」，第 ${job.step} 步，共 ${job.steps} 步`
                  : "老師的聲音，準備錄音"}
          </FocusLabel>
          <FocusTitle>
            {missing.length === 0 ? (
              <>
                <FocusHighlight>
                  <NumberTicker value={clips.length} />
                </FocusHighlight>{" "}
                句都錄好了
              </>
            ) : (
              <>
                還有{" "}
                <FocusHighlight>
                  <NumberTicker value={missing.length} />
                </FocusHighlight>{" "}
                句在錄
              </>
            )}
          </FocusTitle>
        </Focus>
        <ClipList clips={clips} missing={missing} job={job} />
      </div>
    </PortalShell>
  )
}
