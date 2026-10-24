"use client"

import {
  ChevronDownIcon,
  PencilIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { FormDialog, FormField } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { SectionHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { report } from "@/lib/report"

import { add, compare, importCards, remove, update } from "./actions"

type Card = {
  cardId: string
  holderName: string
  holderId: string | null
  member: string | null
  note: string | null
  syncState: string
}

const states: Record<string, string> = {
  missing: "卡機沒有",
  unknown: "未確認",
  deleting: "刪除未確認",
}

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim()

/** Adds a card (no card given, or a stranger's number) or changes one. */
function CardForm({
  card,
  cardId,
  members,
  trigger,
}: {
  card?: Card
  cardId?: string
  members: Member[]
  trigger: React.ReactElement
}) {
  const [holderId, setHolderId] = React.useState(card?.holderId ?? null)
  const memberName = members.find((member) => member.id === holderId)?.name

  async function submit(data: FormData) {
    const input = {
      cardId: card?.cardId ?? text(data, "cardId"),
      holderId,
      holderName: text(data, "holderName") || undefined,
      note: text(data, "note"),
    }
    await report(
      card ? update(input) : add(input),
      card ? "已儲存" : "已新增到卡機"
    )
  }

  return (
    <FormDialog
      trigger={trigger}
      onOpenChange={(open) => open && setHolderId(card?.holderId ?? null)}
      title={card ? "修改門禁卡" : "新增門禁卡"}
      submitLabel={card ? "儲存" : "新增"}
      onSubmit={submit}
    >
      {!card && (
        <FormField label="卡號" required>
          <Input
            name="cardId"
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            defaultValue={cardId}
            className="tabular-nums"
          />
        </FormField>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor="card-member">成員</Label>
        <MemberCombobox
          id="card-member"
          members={members}
          value={holderId}
          onValueChange={setHolderId}
          placeholder="訪客"
          className="w-full"
        />
      </div>
      <FormField label="卡機上的名字" required={!holderId}>
        <Input
          key={holderId ?? "guest"}
          name="holderName"
          placeholder={memberName}
          // Blank means the member's own name.
          defaultValue={
            card?.holderId === holderId && card.holderName !== memberName
              ? card.holderName
              : undefined
          }
        />
      </FormField>
      <FormField label="備註">
        <Input name="note" maxLength={200} defaultValue={card?.note ?? ""} />
      </FormField>
    </FormDialog>
  )
}

export function AddCard({ members }: { members: Member[] }) {
  return <CardForm members={members} trigger={<Button>新增</Button>} />
}

export function CompareButton() {
  const [pending, startTransition] = React.useTransition()
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const { result, error } = await compare()
          if (error || !result) toast.error(error ?? "失敗了")
          else if (result.suspect) toast.error("卡機的卡表疑似損毀")
          else if (result.partial)
            toast.warning(`卡機只列出 ${result.listed} 張，沒列到的卡先不判定`)
          else if (result.deleting.length > 0)
            toast.error(
              `${result.deleting.length} 張要刪的卡還在卡機上，請再刪一次`
            )
          else if (result.missing.length + result.extra.length === 0)
            toast.success("名單與卡機一致")
          else
            toast.warning(
              `卡機缺 ${result.missing.length} 張、多 ${result.extra.length} 張`
            )
        })
      }
    >
      {pending ? "比對中…" : "與卡機比對"}
    </Button>
  )
}

/** Cards swiped at the door that are on no list: enrol one from here. */
export function Strangers({
  strangers,
  members,
}: {
  strangers: { cardId: string; at: string }[]
  members: Member[]
}) {
  return (
    <details className="group flex flex-col gap-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold [&::-webkit-details-marker]:hidden">
        刷過但沒登錄的卡
        <span className="font-normal text-muted-foreground tabular-nums">
          {strangers.length}
        </span>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform duration-state group-open:rotate-180" />
      </summary>
      <ul className="mt-2 flex flex-col">
        {strangers.map((stranger) => (
          <li
            key={stranger.cardId}
            className="flex min-h-14 items-center gap-4 border-b border-border py-2"
          >
            <span className="min-w-0 flex-1 tabular-nums">
              {stranger.cardId}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {stranger.at}
            </span>
            <CardForm
              cardId={stranger.cardId}
              members={members}
              trigger={<Button variant="outline">登錄</Button>}
            />
          </li>
        ))}
      </ul>
    </details>
  )
}

/** Cards the reader holds that the list lacks, from the last comparison. */
export function Extra({
  cards,
}: {
  cards: { cardId: string; name: string }[]
}) {
  const [pending, startTransition] = React.useTransition()
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader
        title="卡機上有、名單沒有"
        actions={
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const { result, error } = await importCards()
                if (error || !result) toast.error(error ?? "失敗了")
                else toast.success(`匯入 ${result.added} 張`)
              })
            }
          >
            {pending ? "匯入中…" : "匯入名單"}
          </Button>
        }
      />
      <ul className="flex flex-col">
        {cards.map((card) => (
          <li
            key={card.cardId}
            className="flex min-h-14 items-center gap-4 border-b border-border py-2"
          >
            <span className="min-w-0 flex-1 truncate">{card.name}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {card.cardId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One card under its holder: number, state and what can be done to it. */
function CardLine({ card, members }: { card: Card; members: Member[] }) {
  const state = states[card.syncState]
  return (
    <div className="flex min-h-10 items-center justify-end gap-4">
      {state && <Badge variant="destructive">{state}</Badge>}
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {card.cardId}
      </span>
      <div className="flex shrink-0 gap-1">
        {(card.syncState === "missing" || card.syncState === "unknown") && (
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon" aria-label="重新加入卡機">
                <RotateCcwIcon />
              </Button>
            }
            title={`把 ${card.holderName} 的卡重新加入卡機？`}
            confirmLabel="加入"
            onConfirm={() =>
              report(
                add({
                  cardId: card.cardId,
                  holderId: card.holderId,
                  holderName: card.holderName,
                  note: card.note ?? "",
                }),
                "已加入卡機"
              )
            }
          />
        )}
        {card.syncState !== "deleting" && (
          <CardForm
            card={card}
            members={members}
            trigger={
              <Button variant="ghost" size="icon" aria-label="修改">
                <PencilIcon />
              </Button>
            }
          />
        )}
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon" aria-label="刪除">
              <Trash2Icon />
            </Button>
          }
          title={`刪除 ${card.holderName} 的卡 ${card.cardId}？刪了就刷不進門`}
          confirmLabel="刪除"
          variant="destructive"
          onConfirm={() => report(remove(card.cardId), "已從卡機刪除")}
        />
      </div>
    </div>
  )
}

/** One row per holder: a member's cards together, a guest's by name. */
export function CardList({
  cards,
  members,
}: {
  cards: Card[]
  members: Member[]
}) {
  if (cards.length === 0) return <EmptyState noun="門禁卡" />
  const holders = new Map<string, Card[]>()
  for (const card of cards) {
    const key = card.holderId ?? `guest:${card.holderName}`
    holders.set(key, [...(holders.get(key) ?? []), card])
  }
  return (
    <ul className="flex flex-col">
      {[...holders].map(([key, held]) => {
        const first = held[0]!
        const names = [...new Set(held.map((card) => card.holderName))]
        const notes = [
          ...new Set(held.flatMap((card) => (card.note ? [card.note] : []))),
        ]
        const shown = first.member ?? first.holderName
        return (
          <li
            key={key}
            className="flex flex-col border-b border-border py-2 sm:flex-row sm:items-start sm:gap-4"
          >
            <span className="flex min-h-10 min-w-0 flex-1 items-center truncate">
              <span className="font-medium">{shown}</span>
              {names
                .filter((name) => name !== shown)
                .map((name) => (
                  <span key={name} className="ml-2 text-muted-foreground">
                    {name}
                  </span>
                ))}
              {notes.map((note) => (
                <span key={note} className="ml-2 text-muted-foreground">
                  {note}
                </span>
              ))}
            </span>
            <div className="flex flex-col sm:shrink-0">
              {held.map((card) => (
                <CardLine key={card.cardId} card={card} members={members} />
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
