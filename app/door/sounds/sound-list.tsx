"use client"

import * as React from "react"
import {
  CheckIcon,
  FileAudioIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { FileUpload } from "@/components/file-upload"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { DoorSound } from "@/lib/actions/door-sounds"
import { report } from "@/lib/report"

import {
  markDefault,
  remove,
  rename,
  replace,
  savePlaylist,
  upload,
} from "./actions"
import { PlayButton } from "./play-button"

const LIMIT = 3 * 1024 * 1024
const text = (data: FormData, key: string) => String(data.get(key) ?? "")

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function UploadSound({ maxSeconds }: { maxSeconds: number }) {
  const [files, setFiles] = React.useState<File[]>([])
  const [label, setLabel] = React.useState("")

  async function submit(data: FormData) {
    const [file] = files
    if (!file) {
      toast.error("請選音檔")
      throw new Error("no file")
    }
    await report(
      upload({ label: text(data, "label"), base64: await base64(file) }),
      "已加進音效池和你的清單"
    )
    setFiles([])
  }

  return (
    <FormDialog
      trigger={<Button>上傳</Button>}
      onOpenChange={(open) => {
        if (open) {
          setFiles([])
          setLabel("")
        }
      }}
      title="上傳音效"
      submitLabel="上傳"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="door-sound-file">音檔，門口播前 {maxSeconds} 秒</Label>
        <FileUpload
          id="door-sound-file"
          value={files}
          onValueChange={(next) => {
            const chosen = next.slice(-1)
            setFiles(chosen)
            if (chosen[0] && !label)
              setLabel(chosen[0].name.replace(/\.[^.]+$/, "").slice(0, 40))
          }}
          accept=".mp3,.m4a,.aac,.wav,.ogg,audio/*"
          acceptLabel="mp3、m4a、aac、wav、ogg"
          maxSize={LIMIT}
        />
      </div>
      <FormField label="名稱" required>
        <Input
          name="label"
          maxLength={40}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </FormField>
    </FormDialog>
  )
}

// A new file for a sound already in the pool: it keeps its name, default
// mark and playlists, so whoever has it hears the new file.
function ReplaceSound({ sound }: { sound: DoorSound }) {
  const [files, setFiles] = React.useState<File[]>([])

  async function submit() {
    const [file] = files
    if (!file) {
      toast.error("請選音檔")
      throw new Error("no file")
    }
    await report(replace(sound.id, await base64(file)), "已換音檔")
  }

  return (
    <FormDialog
      trigger={
        <Button variant="ghost" size="icon" aria-label="換音檔">
          <FileAudioIcon />
        </Button>
      }
      onOpenChange={(open) => {
        if (open) setFiles([])
      }}
      title={`換「${sound.label}」的音檔`}
      submitLabel="換"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor={`door-sound-file-${sound.id}`}>
          {sound.listeners > 0
            ? `${sound.listeners} 人在用，他們也會聽到新的`
            : "新音檔"}
        </Label>
        <FileUpload
          id={`door-sound-file-${sound.id}`}
          value={files}
          onValueChange={(next) => setFiles(next.slice(-1))}
          accept=".mp3,.m4a,.aac,.wav,.ogg,audio/*"
          acceptLabel="mp3、m4a、aac、wav、ogg"
          maxSize={LIMIT}
        />
      </div>
    </FormDialog>
  )
}

// The pool, newest first. Each row plays the sound and puts it on or takes
// it off the member's playlist; its uploader and door admins also rename
// and delete it, and door admins mark the defaults.
export function SoundList({
  sounds,
  canEditAll,
}: {
  sounds: DoorSound[]
  canEditAll: boolean
}) {
  // The playlist as the member sees it, ahead of the refresh, so two quick
  // taps both count.
  const [playlist, setPlaylist] = React.useOptimistic(
    sounds.filter((s) => s.onMyPlaylist).map((s) => s.id)
  )
  const [, startTransition] = React.useTransition()

  function toggle(sound: DoorSound) {
    const on = playlist.includes(sound.id)
    const next = on
      ? playlist.filter((id) => id !== sound.id)
      : [...playlist, sound.id]
    startTransition(async () => {
      setPlaylist(next)
      await report(
        savePlaylist(next),
        on ? `已從清單拿掉「${sound.label}」` : `已加進清單「${sound.label}」`
      ).catch(() => {})
    })
  }

  if (sounds.length === 0) return <EmptyState noun="音效" />
  return (
    <ul className="flex stagger-rise flex-col">
      {sounds.map((sound) => {
        const on = playlist.includes(sound.id)
        const editable = sound.mine || canEditAll
        return (
          <li
            key={sound.id}
            className="flex min-h-14 items-center gap-4 border-b border-border py-2"
          >
            <PlayButton soundId={sound.id} label={sound.label} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate">{sound.label}</span>
              <span className="truncate text-muted-foreground">
                {[
                  sound.uploader ?? "已離開的成員",
                  sound.listeners > 0 && `${sound.listeners} 人在用`,
                ]
                  .filter(Boolean)
                  .join("，")}
              </span>
            </span>
            {sound.isDefault && !canEditAll && (
              <Badge variant="muted">預設</Badge>
            )}
            {canEditAll && (
              <Label className="flex shrink-0 items-center gap-2 text-muted-foreground">
                預設
                <Switch
                  checked={sound.isDefault}
                  onCheckedChange={(checked) =>
                    report(
                      markDefault(sound.id, checked),
                      checked ? "已設為預設" : "已取消預設"
                    ).catch(() => {})
                  }
                />
              </Label>
            )}
            <div className="flex shrink-0 gap-1">
              {editable && (
                <>
                  <FormDialog
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="改名">
                        <PencilIcon />
                      </Button>
                    }
                    title="改名"
                    submitLabel="儲存"
                    onSubmit={(data) =>
                      report(rename(sound.id, text(data, "label")), "已儲存")
                    }
                  >
                    <FormField label="名稱" required>
                      <Input
                        name="label"
                        maxLength={40}
                        defaultValue={sound.label}
                      />
                    </FormField>
                  </FormDialog>
                  <ReplaceSound sound={sound} />
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="icon" aria-label="刪除">
                        <Trash2Icon />
                      </Button>
                    }
                    title={`刪除「${sound.label}」？`}
                    confirmLabel="刪除"
                    variant="destructive"
                    onConfirm={() => report(remove(sound.id), "已刪除")}
                  />
                </>
              )}
              <Button
                variant={on ? "default" : "outline"}
                className="w-24"
                aria-pressed={on}
                onClick={() => toggle(sound)}
              >
                {on ? <CheckIcon /> : <PlusIcon />}
                {on ? "在清單" : "加入"}
              </Button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
