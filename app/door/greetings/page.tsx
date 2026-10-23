import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDoorPhrases } from "@/lib/actions/door-phrases"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName, panelName } from "@/lib/door-greeting"

import { doorNav, doorPage } from "../nav"
import { AddPhrase, PhraseList } from "./phrase-list"

export const dynamic = "force-dynamic"

export default async function DoorGreetingsPage() {
  const actor = await requireActor("/door/greetings")
  await requireAdminPage(actor, "door")
  const [{ phrases, now }, me] = await Promise.all([
    runAction(listDoorPhrases, actor, {}),
    runAction(whoami, actor, {}),
  ])
  const sample = givenName(panelName(me.name ?? "")) || "名字"
  const [only] = now.length === 1 ? phrases.filter((p) => p.id === now[0]) : []
  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <div className="flex flex-col gap-12">
        <PageHeader title="問候語" actions={<AddPhrase sample={sample} />} />
        <Focus>
          <FocusLabel>現在有人開門，門口會說</FocusLabel>
          <FocusTitle>
            {now.length === 0 ? (
              <>
                Hi <FocusHighlight>{sample}</FocusHighlight>
              </>
            ) : only ? (
              <>
                {only.before}
                <FocusHighlight>{sample}</FocusHighlight>
                {only.after || "。"}
              </>
            ) : (
              <>
                從{" "}
                <FocusHighlight>
                  <NumberTicker value={now.length} />
                </FocusHighlight>{" "}
                句裡隨機說一句
              </>
            )}
          </FocusTitle>
        </Focus>
        <PhraseList phrases={phrases} now={now} sample={sample} />
      </div>
    </PortalShell>
  )
}
