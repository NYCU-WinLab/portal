"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"

import { type Member, MemberCombobox } from "@/components/member-combobox"
import type { PageSize } from "@/components/pdf-view"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  type FieldCategory,
  fieldKinds,
  fieldLabel,
  signerTone,
} from "@/lib/approve"
import { cn } from "@/lib/utils"

import { saveFields } from "../actions"

const PdfView = dynamic(
  () => import("@/components/pdf-view").then((m) => m.PdfView),
  { ssr: false }
)

export type EditableField = {
  id: string
  signerId: string | null
  page: number
  x: number
  y: number
  width: number
  height: number
  category: string
  label: string | null
}

const clamp = (value: number, max = 1) => Math.max(0, Math.min(max, value))

// The creator's view of a draft: add boxes from the palette, drag them into
// place, resize from the corner, and say who fills each one. Every change
// saves itself a moment later.
export function FieldEditor({
  id,
  file,
  fields: initial,
  members,
}: {
  id: string
  file: string
  fields: EditableField[]
  members: Member[]
}) {
  const [fields, setFields] = React.useState<EditableField[]>(() =>
    initial.map((f) => ({
      id: f.id,
      signerId: f.signerId,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      category: f.category,
      label: f.label,
    }))
  )
  const [page, setPage] = React.useState(1)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [lastSigner, setLastSigner] = React.useState<string | null>(
    initial.at(-1)?.signerId ?? null
  )
  const saving = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = React.useRef<{
    id: string
    mode: "move" | "resize"
    startX: number
    startY: number
    origin: EditableField
    size: PageSize
    scale: number
  } | null>(null)

  const save = React.useCallback(
    (next: EditableField[]) => {
      if (saving.current) clearTimeout(saving.current)
      saving.current = setTimeout(async () => {
        const { error } = await saveFields({ id, fields: next })
        if (error) toast.error(error)
      }, 600)
    },
    [id]
  )

  function change(next: EditableField[]) {
    setFields(next)
    save(next)
  }

  function update(fieldId: string, patch: Partial<EditableField>) {
    change(fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)))
  }

  function add(category: FieldCategory) {
    const kind = fieldKinds.find((k) => k.category === category)!
    const field: EditableField = {
      id: crypto.randomUUID(),
      signerId: lastSigner,
      page,
      x: clamp(0.5 - kind.width / 2),
      y: clamp(0.5 - kind.height / 2),
      width: kind.width,
      height: kind.height,
      category,
      label: null,
    }
    change([...fields, field])
    setSelected(field.id)
  }

  function start(
    event: React.PointerEvent<SVGElement>,
    field: EditableField,
    mode: "move" | "resize",
    size: PageSize
  ) {
    event.stopPropagation()
    const svg = event.currentTarget.ownerSVGElement!
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelected(field.id)
    drag.current = {
      id: field.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: field,
      size,
      scale: size.width / svg.getBoundingClientRect().width,
    }
  }

  function move(event: React.PointerEvent<SVGGElement>) {
    const d = drag.current
    if (!d) return
    const dx = ((event.clientX - d.startX) * d.scale) / d.size.width
    const dy = ((event.clientY - d.startY) * d.scale) / d.size.height
    setFields((all) =>
      all.map((f) => {
        if (f.id !== d.id) return f
        if (d.mode === "move")
          return {
            ...f,
            x: clamp(d.origin.x + dx, 1 - f.width),
            y: clamp(d.origin.y + dy, 1 - f.height),
          }
        return {
          ...f,
          width: Math.max(0.03, clamp(d.origin.width + dx, 1 - f.x)),
          height: Math.max(0.02, clamp(d.origin.height + dy, 1 - f.y)),
        }
      })
    )
  }

  const latest = React.useRef(fields)
  React.useEffect(() => {
    latest.current = fields
  }, [fields])

  function end() {
    if (!drag.current) return
    drag.current = null
    save(latest.current)
  }

  const names = new Map(members.map((m) => [m.id, m.name]))
  const current = fields.find((f) => f.id === selected) ?? null

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex flex-col gap-4 lg:w-72 lg:shrink-0">
        <div className="flex flex-wrap gap-2">
          {fieldKinds.map((kind) => (
            <Button
              key={kind.category}
              variant="outline"
              onClick={() => add(kind.category)}
            >
              {kind.label}
            </Button>
          ))}
        </div>
        {current ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="field-signer">
                {fieldLabel(current.category, current.label)}由誰填
              </Label>
              <MemberCombobox
                id="field-signer"
                className="w-full"
                members={members}
                value={current.signerId}
                onValueChange={(signerId) => {
                  update(current.id, { signerId })
                  if (signerId) setLastSigner(signerId)
                }}
              />
            </div>
            {current.category === "other" && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="field-label">欄位名稱</Label>
                <Input
                  id="field-label"
                  value={current.label ?? ""}
                  maxLength={100}
                  onChange={(event) =>
                    update(current.id, { label: event.target.value })
                  }
                />
              </div>
            )}
            <Button
              variant="outline"
              className="self-start"
              onClick={() => {
                change(fields.filter((f) => f.id !== current.id))
                setSelected(null)
              }}
            >
              刪除這個欄位
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">
            {fields.length ? "點一個欄位來改" : "從上面加欄位"}
          </p>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <PdfView file={file} page={page} onPageChange={setPage}>
          {(size) => (
            <g
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onPointerDown={() => setSelected(null)}
            >
              <rect
                width={size.width}
                height={size.height}
                fill="transparent"
              />
              {fields
                .filter((f) => f.page === page)
                .map((f) => {
                  const x = f.x * size.width
                  const y = f.y * size.height
                  const w = f.width * size.width
                  const h = f.height * size.height
                  return (
                    <g key={f.id}>
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        rx={4}
                        className={cn(
                          "cursor-move",
                          signerTone(f.signerId),
                          f.id === selected ? "stroke-2" : "stroke-1"
                        )}
                        strokeDasharray={f.signerId ? undefined : "4 3"}
                        onPointerDown={(event) => start(event, f, "move", size)}
                      />
                      <text
                        x={x + 4}
                        y={y + 14}
                        className="pointer-events-none"
                        fill="black"
                        fontSize={12}
                      >
                        {fieldLabel(f.category, f.label)}
                        {f.signerId
                          ? `，${names.get(f.signerId) ?? ""}`
                          : "，未指定"}
                      </text>
                      <rect
                        x={x + w - 8}
                        y={y + h - 8}
                        width={10}
                        height={10}
                        className="cursor-se-resize"
                        fill="black"
                        onPointerDown={(event) =>
                          start(event, f, "resize", size)
                        }
                      />
                    </g>
                  )
                })}
            </g>
          )}
        </PdfView>
      </div>
    </div>
  )
}
