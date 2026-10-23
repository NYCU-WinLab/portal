import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { StatusPage } from "@/components/status-page"
import { NumberTicker } from "@/components/ui/number-ticker"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDoorVoiceClips } from "@/lib/actions/door-phrases"
import { requireActor } from "@/lib/auth/session"

import { doorNav, doorPage } from "../nav"
import { ClipList } from "./clip-list"

export const dynamic = "force-dynamic"

export default async function DoorVoicePage() {
  const actor = await requireActor("/door/voice")
  if (!(await isAdmin(actor, "door")))
    return (
      <PortalShell page={doorPage} layout="spotlight">
        <StatusPage title="門口語音只有 Door 管理員能看" />
      </PortalShell>
    )
  const { clips, missing } = await runAction(listDoorVoiceClips, actor, {})
  return (
    <PortalShell page={doorPage} nav={doorNav(true)}>
      <div className="flex flex-col gap-12">
        <PageHeader title="語音" />
        <Focus>
          <FocusLabel>老師的聲音</FocusLabel>
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
        <ClipList clips={clips} missing={missing} />
      </div>
    </PortalShell>
  )
}
