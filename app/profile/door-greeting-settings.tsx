"use client"

import * as React from "react"

import { FieldList, FieldRow } from "@/components/field-list"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { report } from "@/lib/report"

import {
  chooseDoorSound,
  removeDoorSound,
  saveDoorSound,
  saveDoorSuffix,
} from "./actions"

// What the door says when the member comes in: the panel's suffix after
// their name, and their own sound instead of the lab's.
export function DoorGreetingSettings({
  suffix,
  hasSound,
  playSound,
}: {
  suffix: string | null
  hasSound: boolean
  playSound: boolean
}) {
  const [text, setText] = React.useState(suffix ?? "")
  const [busy, setBusy] = React.useState(false)
  const file = React.useRef<HTMLInputElement>(null)

  async function upload(chosen: File) {
    setBusy(true)
    try {
      const bytes = new Uint8Array(await chosen.arrayBuffer())
      let binary = ""
      for (let i = 0; i < bytes.length; i += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      await report(saveDoorSound(btoa(binary)), "已換成你的音效")
    } catch {
      // report already said why.
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ""
    }
  }

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
      <FieldRow label="播我的音效">
        <Switch
          checked={playSound}
          disabled={!hasSound}
          aria-label="播我的音效"
          onCheckedChange={(checked) =>
            report(
              chooseDoorSound(checked),
              checked ? "會播你的音效" : "改播實驗室的音效"
            ).catch(() => {})
          }
        />
      </FieldRow>
      <FieldRow label="音效">
        <div className="flex gap-2">
          <input
            ref={file}
            type="file"
            accept=".mp3,.m4a,.aac,.wav,.ogg,audio/*"
            hidden
            onChange={(event) => {
              const chosen = event.target.files?.[0]
              if (chosen) void upload(chosen)
            }}
          />
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => file.current?.click()}
          >
            {busy ? "上傳中…" : hasSound ? "換一個" : "上傳"}
          </Button>
          {hasSound && (
            <Button
              variant="ghost"
              onClick={() =>
                report(removeDoorSound(), "已刪除").catch(() => {})
              }
            >
              刪除
            </Button>
          )}
        </div>
      </FieldRow>
    </FieldList>
  )
}
