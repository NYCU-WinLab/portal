"use client"

import * as React from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// A signature is ink on paper in every theme: it ends up on printed
// documents, so it never follows dark mode. These two are the only colors
// in the block, and they never reach the page's UI.
const INK = "black"
const PAPER = "white"
const HEIGHT = 200

type Point = { x: number; y: number }

/** PNG of the strokes alone on a transparent background, cropped to them. */
function exportStrokes(strokes: Point[][], width: number) {
  const points = strokes.flat()
  if (points.length === 0) return null
  const pad = 8
  const left = Math.max(0, Math.min(...points.map((p) => p.x)) - pad)
  const top = Math.max(0, Math.min(...points.map((p) => p.y)) - pad)
  const right = Math.min(width, Math.max(...points.map((p) => p.x)) + pad)
  const bottom = Math.min(HEIGHT, Math.max(...points.map((p) => p.y)) + pad)
  const scale = 2
  const canvas = document.createElement("canvas")
  canvas.width = Math.ceil((right - left) * scale)
  canvas.height = Math.ceil((bottom - top) * scale)
  const ctx = canvas.getContext("2d")
  if (!ctx) return null
  ctx.scale(scale, scale)
  ctx.translate(-left, -top)
  drawStrokes(ctx, strokes)
  return canvas.toDataURL("image/png")
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Point[][]) {
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = 2.5
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      ctx.beginPath()
      ctx.arc(stroke[0].x, stroke[0].y, 1.25, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    stroke.forEach((point, index) =>
      index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)
    )
    ctx.stroke()
  }
}

// Draw with a finger, pen or mouse on white paper.
function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const box = React.useRef<HTMLDivElement>(null)
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const strokes = React.useRef<Point[][]>([])
  const [width, setWidth] = React.useState(0)
  const [empty, setEmpty] = React.useState(true)

  const redraw = React.useCallback(() => {
    const node = canvas.current
    const ctx = node?.getContext("2d")
    if (!node || !ctx) return
    const ratio = window.devicePixelRatio || 1
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.fillStyle = PAPER
    ctx.fillRect(0, 0, node.width, node.height)
    drawStrokes(ctx, strokes.current)
  }, [])

  React.useEffect(() => {
    const node = box.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width))
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  React.useEffect(redraw, [width, redraw])

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function finish() {
    setEmpty(strokes.current.length === 0)
    onChange(exportStrokes(strokes.current, width))
  }

  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1
  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        className="h-50 overflow-hidden rounded-control border border-border"
      >
        <canvas
          ref={canvas}
          width={width * ratio}
          height={HEIGHT * ratio}
          aria-label="簽名區"
          className="size-full touch-none"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            strokes.current.push([point(event)])
            redraw()
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
            strokes.current.at(-1)?.push(point(event))
            redraw()
          }}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        disabled={empty}
        onClick={() => {
          strokes.current = []
          redraw()
          finish()
        }}
      >
        清除
      </Button>
    </div>
  )
}

// A saved signature on its white paper, for showing it on a page.
function SignaturePreview({
  src,
  className,
}: {
  src: string
  className?: string
}) {
  return (
    <div
      data-slot="signature-preview"
      className={cn(
        "flex h-24 items-center justify-center rounded-control border border-border bg-(--paper) p-2 [--paper:white]",
        className
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="簽名" className="max-h-full max-w-full" />
    </div>
  )
}

// Pick a PNG or JPEG of a signature, previewed on the same white paper.
function UploadPad({
  onChange,
}: {
  onChange: (dataUrl: string | null) => void
}) {
  const [preview, setPreview] = React.useState<string | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <input
        type="file"
        accept="image/png,image/jpeg"
        aria-label="選擇簽名圖片"
        className="text-body file:mr-4 file:h-10 file:rounded-control file:border file:border-border file:bg-background file:px-4 file:font-medium"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => {
            const dataUrl = String(reader.result)
            setPreview(dataUrl)
            onChange(dataUrl)
          }
          reader.readAsDataURL(file)
        }}
      />
      {preview && <SignaturePreview src={preview} className="h-50" />}
    </div>
  )
}

// 簽名: draw or upload a signature, then save it. onSave receives a PNG or
// JPEG data URL; throw to keep the dialog open (report the error yourself).
function SignaturePad({
  trigger,
  title = "簽名",
  onSave,
}: {
  trigger: React.ReactElement
  title?: string
  onSave: (dataUrl: string) => void | Promise<void>
}) {
  const [open, setOpen] = React.useState(false)
  const [tab, setTab] = React.useState("draw")
  const [drawn, setDrawn] = React.useState<string | null>(null)
  const [uploaded, setUploaded] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()
  const value = tab === "draw" ? drawn : uploaded

  function save() {
    if (!value) return
    startTransition(async () => {
      try {
        await onSave(value)
        setOpen(false)
      } catch (error) {
        console.error(error)
      }
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (next) {
          setDrawn(null)
          setUploaded(null)
        }
      }}
    >
      <DialogTrigger render={trigger} />
      <DialogContent showCloseButton={false}>
        <DialogHeader className="pr-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(next) => setTab(String(next))}
          className="flex flex-col gap-4"
        >
          <TabsList>
            <TabsTrigger value="draw">手寫</TabsTrigger>
            <TabsTrigger value="upload">上傳圖片</TabsTrigger>
          </TabsList>
          <TabsContent value="draw">
            {open && <DrawPad onChange={setDrawn} />}
          </TabsContent>
          <TabsContent value="upload">
            <UploadPad onChange={setUploaded} />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <DialogClose
            disabled={pending}
            render={<Button type="button" variant="outline" />}
          >
            取消
          </DialogClose>
          <Button disabled={!value || pending} onClick={save}>
            {pending ? "儲存中…" : "儲存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { SignaturePad, SignaturePreview }
