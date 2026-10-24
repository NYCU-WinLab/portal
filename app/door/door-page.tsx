import { PortalShell } from "@/components/portal-shell"
import { runAction } from "@/lib/actions/define"
import { getDoorStatus } from "@/lib/actions/door"
import { requireActor } from "@/lib/auth/session"

import { DoorButton } from "./door-button"
import { doorNav, doorPage } from "./nav"

/** /door: the button. */
export async function DoorPage() {
  const actor = await requireActor("/door")
  const status = await runAction(getDoorStatus, actor, {})
  return (
    <PortalShell page={doorPage} nav={doorNav} layout="spotlight">
      <DoorButton configured={status.configured} online={status.online} />
    </PortalShell>
  )
}
