import { PortalShell } from "@/components/portal-shell"
import { isAdmin } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { getDoorStatus } from "@/lib/actions/door"
import { requireActor } from "@/lib/auth/session"

import { DoorButton } from "./door-button"
import { doorNav, doorPage } from "./nav"

/** /door and /door/go: the same button; /door/go also presses it. */
export async function DoorPage({ autoOpen }: { autoOpen: boolean }) {
  const actor = await requireActor(autoOpen ? "/door/go" : "/door")
  const [status, admin] = await Promise.all([
    runAction(getDoorStatus, actor, {}),
    isAdmin(actor, "door"),
  ])
  return (
    <PortalShell page={doorPage} nav={doorNav(admin)} layout="spotlight">
      <DoorButton
        configured={status.configured}
        online={status.online}
        autoOpen={autoOpen}
      />
    </PortalShell>
  )
}
