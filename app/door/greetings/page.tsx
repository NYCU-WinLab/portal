import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
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
  const [{ phrases, now, can_edit }, me] = await Promise.all([
    runAction(listDoorPhrases, actor, {}),
    runAction(whoami, actor, {}),
  ])
  const sample = givenName(panelName(me.name ?? "")) || "名字"
  const current = phrases.find((phrase) => phrase.id === now)
  return (
    <PortalShell page={doorPage} nav={doorNav(can_edit)}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="問候語"
          actions={can_edit ? <AddPhrase sample={sample} /> : undefined}
        />
        <Focus>
          <FocusLabel>你現在開門，門口會說</FocusLabel>
          <FocusTitle>
            {current ? (
              <>
                {current.before}
                <FocusHighlight>{sample}</FocusHighlight>
                {current.after || "。"}
              </>
            ) : (
              <>
                Hi <FocusHighlight>{sample}</FocusHighlight>
              </>
            )}
          </FocusTitle>
        </Focus>
        <PhraseList phrases={phrases} canEdit={can_edit} sample={sample} />
      </div>
    </PortalShell>
  )
}
