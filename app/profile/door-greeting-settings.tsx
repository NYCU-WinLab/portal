"use client"

import * as React from "react"
import Link from "next/link"

import { FieldList, FieldRow } from "@/components/field-list"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import { PlayButton } from "../door/sounds/play-button"
import { saveDoorSpeakName, saveDoorSuffix } from "./actions"

// What the door says when the member comes in: the panel's suffix after
// their name, whether the door says "Hi <name>" first, and the playlist it picks a sound from (kept on /door/sounds).
export function DoorGreetingSettings({
  suffix,
  speakName,
  playlist,
}: {
  suffix: string | null
  speakName: boolean
  playlist: { id: string; version: string; label: string }[]
}) {
  const [text, setText] = React.useState(suffix ?? "")

  return (
    <FieldList>
      <FieldRow label="名字後面">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            report(saveDoorSuffix(text), "已儲存").catch(() => {})
          }}
        >
          <Input
            value={text}
            placeholder="！！"
            aria-label="名字後面"
            className="w-32"
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" variant="outline">
            儲存
          </Button>
        </form>
      </FieldRow>
      <FieldRow label="念我的名字">
        <Switch
          checked={speakName}
          aria-label="念我的名字"
          onCheckedChange={(checked) =>
            report(
              saveDoorSpeakName(checked),
              checked ? "開門會先念 Hi 你的名字" : "開門只播音效"
            ).catch(() => {})
          }
        />
      </FieldRow>
      <FieldRow label="開門音效">
        <div className="flex flex-col gap-2">
          {playlist.length === 0 ? (
            <span className="text-muted-foreground">實驗室預設</span>
          ) : (
            <ul className="flex flex-col">
              {playlist.map((sound) => (
                <li key={sound.id} className="flex items-center gap-2">
                  <PlayButton
                    soundId={sound.id}
                    version={sound.version}
                    label={sound.label}
                  />
                  <span className="truncate">{sound.label}</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/door/sounds"
            prefetch
            className={buttonVariants({
              variant: "outline",
              className: "self-start",
            })}
          >
            音效池
          </Link>
        </div>
      </FieldRow>
    </FieldList>
  )
}
