"use client"

import * as React from "react"

import { type Member, MemberCombobox } from "@/components/member-combobox"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { setManager } from "../actions"

const outcome = (pending: Promise<{ error?: string }>) => pending

export function Managers({
  groupId,
  managers,
  members,
  canEdit,
}: {
  groupId: string
  managers: { userId: string; name: string }[]
  members: Member[]
  canEdit: boolean
}) {
  const [picked, setPicked] = React.useState<string | null>(null)
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {managers.length === 0 && (
          <li className="text-muted-foreground">只有 Portal 管理員</li>
        )}
        {managers.map((m) => (
          <li
            key={m.userId}
            className="flex min-h-14 items-center gap-4 border-b border-border py-2"
          >
            <span className="flex-1">{m.name}</span>
            {canEdit && (
              <Button
                variant="ghost"
                onClick={() =>
                  report(
                    outcome(setManager(groupId, m.userId, false)),
                    "已移除"
                  ).catch(() => {})
                }
              >
                移除
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <MemberCombobox
            className="w-64"
            members={members}
            value={picked}
            onValueChange={setPicked}
          />
          <Button
            variant="outline"
            disabled={!picked}
            onClick={() =>
              picked &&
              report(outcome(setManager(groupId, picked, true)), "已指派")
                .then(() => setPicked(null))
                .catch(() => {})
            }
          >
            指派
          </Button>
        </div>
      )}
    </div>
  )
}
