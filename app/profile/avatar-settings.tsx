"use client"

import * as React from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { report } from "@/lib/report"

import { removeAvatar, saveAvatar } from "./actions"

const LIMIT = 5 * 1024 * 1024

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

// The crop frame, in CSS px, and the picture sent from it.
const FRAME = 256
const OUT = 512
const ZOOM_MAX = 4

type View = { zoom: number; x: number; y: number }

// Where the picture sits in the frame: scaled to cover it at zoom 1, never
// leaving a gap at the edges.
function place(img: HTMLImageElement, zoom: number, x: number, y: number) {
  const scale =
    Math.max(FRAME / img.naturalWidth, FRAME / img.naturalHeight) * zoom
  const width = img.naturalWidth * scale
  const height = img.naturalHeight * scale
  return {
    scale,
    width,
    height,
    x: Math.min(0, Math.max(FRAME - width, x)),
    y: Math.min(0, Math.max(FRAME - height, y)),
  }
}

// The member drags the picture and zooms it inside a round frame, the
// shape every avatar shows in; saving draws that part to a square.
function CropDialog({
  file,
  onClose,
}: {
  file: File | null
  onClose: () => void
}) {
  const [image, setImage] = React.useState<HTMLImageElement | null>(null)
  const [view, setView] = React.useState<View>({ zoom: 1, x: 0, y: 0 })
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const drag = React.useRef<{ x: number; y: number } | null>(null)

  React.useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    const next = new Image()
    next.onload = () => {
      const fit = place(next, 1, 0, 0)
      setView({
        zoom: 1,
        x: (FRAME - fit.width) / 2,
        y: (FRAME - fit.height) / 2,
      })
      setImage(next)
    }
    next.onerror = () => {
      toast.error("讀不懂這張圖片")
      onClose()
    }
    next.src = url
    return () => {
      URL.revokeObjectURL(url)
      setImage(null)
    }
  }, [file, onClose])

  const at = image ? place(image, view.zoom, view.x, view.y) : null

  // The preview, drawn sharp on high-density screens.
  React.useEffect(() => {
    const el = canvas.current
    if (!el || !image || !at) return
    const ratio = window.devicePixelRatio || 1
    el.width = FRAME * ratio
    el.height = FRAME * ratio
    const ctx = el.getContext("2d")!
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, FRAME, FRAME)
    ctx.drawImage(image, at.x, at.y, at.width, at.height)
  })

  // Zooms around the centre of the frame.
  function zoomTo(zoom: number) {
    if (!image || !at) return
    const next = Math.min(ZOOM_MAX, Math.max(1, zoom))
    const cx = (FRAME / 2 - at.x) / at.scale
    const cy = (FRAME / 2 - at.y) / at.scale
    const scale = place(image, next, 0, 0).scale
    const fixed = place(
      image,
      next,
      FRAME / 2 - cx * scale,
      FRAME / 2 - cy * scale
    )
    setView({ zoom: next, x: fixed.x, y: fixed.y })
  }

  async function submit() {
    if (!image || !at) throw new Error("no image")
    const out = document.createElement("canvas")
    out.width = OUT
    out.height = OUT
    out
      .getContext("2d")!
      .drawImage(
        image,
        -at.x / at.scale,
        -at.y / at.scale,
        FRAME / at.scale,
        FRAME / at.scale,
        0,
        0,
        OUT,
        OUT
      )
    const blob = await new Promise<Blob | null>((resolve) =>
      out.toBlob(resolve, "image/jpeg", 0.92)
    )
    if (!blob) {
      toast.error("裁切失敗")
      throw new Error("no blob")
    }
    await report(saveAvatar(await base64(blob)), "已換頭像")
  }

  return (
    <FormDialog
      open={Boolean(file)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="裁切頭像"
      submitLabel="儲存"
      onSubmit={submit}
    >
      <div className="flex flex-col items-center gap-4">
        <canvas
          ref={canvas}
          aria-label="拖曳調整位置"
          className="size-64 cursor-grab touch-none rounded-full bg-muted select-none active:cursor-grabbing"
          onPointerDown={(event) => {
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // A synthetic pointer has nothing to capture.
            }
            drag.current = { x: event.clientX, y: event.clientY }
          }}
          onPointerMove={(event) => {
            if (!drag.current || !image) return
            const dx = event.clientX - drag.current.x
            const dy = event.clientY - drag.current.y
            drag.current = { x: event.clientX, y: event.clientY }
            setView((now) => {
              const next = place(image, now.zoom, now.x + dx, now.y + dy)
              return { zoom: now.zoom, x: next.x, y: next.y }
            })
          }}
          onPointerUp={() => {
            drag.current = null
          }}
          onPointerCancel={() => {
            drag.current = null
          }}
          onWheel={(event) =>
            zoomTo(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1))
          }
        />
        <input
          type="range"
          aria-label="縮放"
          min={1}
          max={ZOOM_MAX}
          step={0.01}
          value={view.zoom}
          disabled={!image}
          onChange={(event) => zoomTo(Number(event.target.value))}
          className="w-64 accent-primary"
        />
      </div>
    </FormDialog>
  )
}

// The member's picture: every signed-in lab member sees it next to their
// name. A picked file opens the crop dialog before anything is uploaded.
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
  const [file, setFile] = React.useState<File | null>(null)
  const close = React.useCallback(() => setFile(null), [])

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    if (file.size > LIMIT) {
      toast.error("圖片超過 5 MB")
      return
    }
    setFile(file)
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
        <Button variant="outline" onClick={() => input.current?.click()}>
          {version ? "換一張" : "上傳"}
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
      <CropDialog file={file} onClose={close} />
    </div>
  )
}
