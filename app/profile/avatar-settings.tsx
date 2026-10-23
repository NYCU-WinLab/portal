"use client"

import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { removeAvatar, saveAvatar } from "./actions"

const LIMIT = 5 * 1024 * 1024

async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// The member's picture: every signed-in lab member sees it next to their
// name. The portal crops it to the centre.
export function AvatarSettings({
  userId,
  name,
  version,
}: {
  userId: string
  name: string
  version: string | null
}) {
  const input = React.useRef<HTMLInputElement>(null)
  const [pending, startTransition] = React.useTransition()

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > LIMIT) {
      toast.error("圖片超過 5 MB")
      return
    }
    startTransition(async () => {
      await report(saveAvatar(await base64(file)), "已換頭像").catch(() => {})
    })
  }

  return (
    <div className="flex items-center gap-6">
      <Avatar className="size-24">
        {version && (
          <AvatarImage
            src={`/avatars/${userId}?size=large&v=${version}`}
            alt=""
          />
        )}
        <AvatarFallback className="text-title">
          {Array.from(name.trim())[0] ?? "?"}
        </AvatarFallback>
      </Avatar>
      <div className="flex gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={pick}
        />
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => input.current?.click()}
        >
          {pending ? "上傳中…" : version ? "換一張" : "上傳"}
        </Button>
        {version && (
          <ConfirmDialog
            trigger={<Button variant="ghost">移除</Button>}
            title="移除頭像？"
            confirmLabel="移除"
            variant="destructive"
            onConfirm={() => report(removeAvatar(), "已移除頭像")}
          />
        )}
      </div>
    </div>
  )
}
