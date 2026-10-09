"use client"

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"
import * as React from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { FormDialog } from "@/components/form-dialog"
import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import { presenterAdd, presenterMove, presenterRemove } from "../actions"
import { report } from "../report"

export function AddPresenter({ members }: { members: Member[] }) {
  const [userId, setUserId] = React.useState<string | null>(null)
  return (
    <FormDialog
      trigger={<Button>加入</Button>}
      title="加入報告順序"
      submitLabel="加入"
      onSubmit={async () => {
        await report(presenterAdd({ userId: userId ?? "" }), "已加入")
        setUserId(null)
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="presenter-member">成員</Label>
        <MemberCombobox
          id="presenter-member"
          members={members}
          value={userId}
          onValueChange={setUserId}
          className="w-full"
        />
      </div>
    </FormDialog>
  )
}

export function PresenterRowActions({
  userId,
  name,
}: {
  userId: string
  name: string
}) {
  const [pending, startTransition] = React.useTransition()
  const move = (direction: "up" | "down") =>
    startTransition(async () => {
      await report(presenterMove({ userId, direction }), "已調整").catch(
        () => {}
      )
    })

  return (
    <div className="flex shrink-0 gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label="上移"
        disabled={pending}
        onClick={() => move("up")}
      >
        <ArrowUpIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="下移"
        disabled={pending}
        onClick={() => move("down")}
      >
        <ArrowDownIcon />
      </Button>
      <ConfirmDialog
        trigger={<Button variant="ghost">移出</Button>}
        title={`把${name}移出報告順序？`}
        confirmLabel="移出"
        onConfirm={() => report(presenterRemove({ userId }), "已移出")}
      />
    </div>
  )
}
