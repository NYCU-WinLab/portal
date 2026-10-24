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
import { listMembers } from "@/lib/actions/admins"
import { requireAdminPage } from "@/lib/actions/authz"
import { runAction } from "@/lib/actions/define"
import { listDoorCards } from "@/lib/actions/door-cards"
import { requireActor } from "@/lib/auth/session"

import { doorNav, doorPage } from "../nav"
import { AddCard, CardList, CompareButton, Extra, Strangers } from "./card-list"

export const dynamic = "force-dynamic"

const when = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

type Compared = {
  readerCount: number
  suspect: boolean
  missing: string[]
  extra: { cardId: string; name: string }[]
}

export default async function DoorCardsPage() {
  const actor = await requireActor("/door/cards")
  await requireAdminPage(actor, "door")
  const [{ cards, strangers, lastCompare }, members] = await Promise.all([
    runAction(listDoorCards, actor, {}),
    runAction(listMembers, actor, {}),
  ])
  const compared = lastCompare?.detail as Compared | null | undefined
  const missing = cards.filter((card) => card.syncState !== "synced").length
  const extra = compared?.extra.filter(
    (card) => !cards.some((listed) => listed.cardId === card.cardId)
  )

  return (
    <PortalShell page={doorPage} nav={doorNav}>
      <div className="flex flex-col gap-12">
        <PageHeader
          title="門禁卡"
          actions={
            <>
              <CompareButton />
              <AddCard members={members} />
            </>
          }
        />
        <Focus>
          <FocusLabel>名單</FocusLabel>
          <FocusTitle>
            <FocusHighlight>
              <NumberTicker value={cards.length} />
            </FocusHighlight>{" "}
            張卡
            {missing > 0 && (
              <>
                ，<FocusHighlight>{missing}</FocusHighlight> 張卡機沒有或未確認
              </>
            )}
          </FocusTitle>
          {lastCompare && (
            <FocusMeta>
              <span>上次比對 {when.format(lastCompare.at)}</span>
              {compared ? (
                <span>
                  {compared.suspect
                    ? `卡機回報 ${compared.readerCount} 張，卡表疑似損毀`
                    : `卡機 ${compared.readerCount} 張`}
                </span>
              ) : (
                <span className="text-destructive">讀不到卡機</span>
              )}
            </FocusMeta>
          )}
        </Focus>
        {strangers.length > 0 && (
          <Strangers
            strangers={strangers.map((stranger) => ({
              cardId: stranger.cardId,
              at: when.format(stranger.at),
            }))}
            members={members}
          />
        )}
        {extra && extra.length > 0 && <Extra cards={extra} />}
        <CardList cards={cards} members={members} />
      </div>
    </PortalShell>
  )
}
