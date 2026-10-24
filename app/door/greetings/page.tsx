import {
  Focus,
  FocusHighlight,
  FocusLabel,
  FocusTitle,
} from "@/components/focus"
import Link from "next/link"

import { ProgressRefresh } from "@/components/live-refresh"
import { PageHeader, SectionHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { PortalShell } from "@/components/portal-shell"
import { NumberTicker } from "@/components/ui/number-ticker"
import { runAction } from "@/lib/actions/define"
import { listDoorPhrases, listDoorVoiceClips } from "@/lib/actions/door-phrases"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"
import { givenName, panelName, voiceParts } from "@/lib/door-greeting"

import { doorNav, doorPage } from "../nav"
import { AddPhrase, PhraseList, type Recording } from "./phrase-list"

export const dynamic = "force-dynamic"

export default async function DoorGreetingsPage() {
  const actor = await requireActor("/door/greetings")
  const [{ mine, defaults, now, can_edit_defaults }, me] = await Promise.all([
    runAction(listDoorPhrases, actor, {}),
    runAction(whoami, actor, {}),
  ])
  // The recording status reads the voice clips, which only door admins see.
  const { missing, job } = can_edit_defaults
    ? await runAction(listDoorVoiceClips, actor, {})
    : { missing: [], job: { text: null, step: 0, steps: 0, online: false } }
  // A phrase is still being recorded while its own words have no clip.
  const waiting = new Set(missing)
  const recording = Object.fromEntries(
    [...mine, ...defaults].flatMap((phrase): [string, Recording][] => {
      const parts = voiceParts("", phrase.before, phrase.after)
      if (job.text && parts.includes(job.text))
        return [[phrase.id, { step: job.step, steps: job.steps }]]
      if (parts.some((part) => waiting.has(part)))
        return [[phrase.id, job.online ? "排隊中" : "等 furnace"]]
      return []
    })
  )
  const sample = givenName(panelName(me.name ?? "")) || "名字"
  const [only] =
    now.length === 1
      ? [...mine, ...defaults].filter((p) => p.id === now[0])
      : []
  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <ProgressRefresh topic="door_voice" />
      <div className="flex flex-col gap-12">
        <PageHeader title="問候語" actions={<AddPhrase sample={sample} />} />
        <Focus>
          <FocusLabel>現在你開門，門口會說</FocusLabel>
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
        <section className="flex flex-col gap-4">
          <SectionHeader title="我的" />
          <PhraseList
            phrases={mine}
            now={now}
            sample={sample}
            lab={false}
            recording={recording}
            editable
          />
        </section>
        <section className="flex flex-col gap-4">
          <SectionHeader
            title="預設，我的沒排到的時段說"
            actions={
              can_edit_defaults && (
                <AddPhrase
                  lab
                  sample={sample}
                  trigger={<Button variant="outline">新增預設</Button>}
                />
              )
            }
          />
          <PhraseList
            phrases={defaults}
            now={now}
            sample={sample}
            lab
            recording={recording}
            editable={can_edit_defaults}
          />
        </section>
      </div>
    </PortalShell>
  )
}
