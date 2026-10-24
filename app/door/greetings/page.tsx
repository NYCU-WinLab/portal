import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import Link from "next/link"

import { ProgressRefresh } from "@/components/live-refresh"
import { PageHeader } from "@/components/page-header"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDoorPhrases, listDoorVoiceClips } from "@/lib/actions/door-phrases"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName, panelName, voiceParts } from "@/lib/door-greeting"

import { doorNav, doorPage } from "../nav"
import { AddPhrase, PhraseList } from "./phrase-list"

export const dynamic = "force-dynamic"

export default async function DoorGreetingsPage() {
  const actor = await requireActor("/door/greetings")
  await requireAdminPage(actor, "door")
  const [{ phrases, now }, me, { missing, job }] = await Promise.all([
    runAction(listDoorPhrases, actor, {}),
    runAction(whoami, actor, {}),
    runAction(listDoorVoiceClips, actor, {}),
  ])
  // A phrase is still being recorded while its own words have no clip.
  const waiting = new Set(missing)
  const recording = Object.fromEntries(
    phrases.flatMap((phrase) => {
      const parts = voiceParts("", phrase.before, phrase.after)
      if (job.text && parts.includes(job.text))
        return [[phrase.id, `錄製中 ${job.step}/${job.steps}`]]
      if (parts.some((part) => waiting.has(part)))
        return [[phrase.id, job.online ? "排隊中" : "等 furnace"]]
      return []
    })
  )
  const sample = givenName(panelName(me.name ?? "")) || "名字"
  const [only] = now.length === 1 ? phrases.filter((p) => p.id === now[0]) : []
  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <ProgressRefresh topic="door_voice" />
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
        {missing.length > 0 && (
          <p className="text-muted-foreground">
            <Link
              href="/door/voice"
              className="underline-offset-4 hover:underline"
            >
              老師的聲音還有 {missing.length} 句在錄
              {job.text
                ? `，正在錄「${job.text}」${job.step}/${job.steps}`
                : job.online
                  ? ""
                  : "，furnace 沒有連線"}
            </Link>
            ，錄好前門口先用一般語音。
          </p>
        )}
        <PhraseList
          phrases={phrases}
          now={now}
          sample={sample}
          recording={recording}
        />
      </div>
    </PortalShell>
  )
}
