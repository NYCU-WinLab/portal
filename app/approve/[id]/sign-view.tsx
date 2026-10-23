"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { fieldLabel } from "@/lib/approve"
import { report } from "@/lib/report"

import { signDocument } from "../actions"
import { FieldValues, type ShownField } from "./field-values"

const PdfView = dynamic(
  () => import("@/components/pdf-view").then((m) => m.PdfView),
  { ssr: false }
)

// A signer's view: their own boxes to fill, prefilled from last time, and
// their saved signature in each signature box.
export function SignView({
  id,
  file,
  fields,
  toFill,
  signature,
}: {
  id: string
  file: string
  fields: ShownField[]
  toFill: {
    id: string
    category: string
    label: string | null
    prefill: string | null
  }[]
  signature: string | null
}) {
  const router = useRouter()
  const [page, setPage] = React.useState(1)
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      toFill
        .filter((f) => f.category !== "signature")
        .map((f) => [f.id, f.prefill ?? ""])
    )
  )
  const [busy, setBusy] = React.useState(false)
  const mine = new Set(toFill.map((f) => f.id))
  const needsSignature = toFill.some((f) => f.category === "signature")
  const others = fields.filter((f) => !mine.has(f.id))

  async function sign() {
    setBusy(true)
    try {
      await report(signDocument({ id, values }), "已簽核")
      router.push("/approve")
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {needsSignature && !signature ? (
        <p className="text-destructive">
          你還沒有存簽名，先到
          <Link href="/profile" className="underline underline-offset-4">
            個人頁
          </Link>
          簽名再回來。
        </p>
      ) : (
        <Button className="self-start" disabled={busy} onClick={sign}>
          {busy ? "簽核中…" : "簽核"}
        </Button>
      )}
      <PdfView file={file} page={page} onPageChange={setPage}>
        {(size) => (
          <>
            <FieldValues fields={others} page={page} size={size} />
            {fields
              .filter((f) => mine.has(f.id) && f.page === page)
              .map((f) => {
                const x = f.x * size.width
                const y = f.y * size.height
                const w = f.width * size.width
                const h = f.height * size.height
                if (f.category === "signature")
                  return signature ? (
                    <image
                      key={f.id}
                      href={signature}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                    />
                  ) : (
                    <rect
                      key={f.id}
                      x={x}
                      y={y}
                      width={w}
                      height={h}
                      className="fill-warning/20 stroke-warning"
                    />
                  )
                const kind = toFill.find((t) => t.id === f.id)!
                return (
                  <foreignObject key={f.id} x={x} y={y} width={w} height={h}>
                    <input
                      aria-label={fieldLabel(kind.category, kind.label)}
                      placeholder={fieldLabel(kind.category, kind.label)}
                      value={values[f.id] ?? ""}
                      onChange={(event) =>
                        setValues((all) => ({
                          ...all,
                          [f.id]: event.target.value,
                        }))
                      }
                      className="h-full w-full rounded-control bg-background px-1 text-foreground ring-1 ring-warning outline-none placeholder:text-muted-foreground"
                    />
                  </foreignObject>
                )
              })}
          </>
        )}
      </PdfView>
    </div>
  )
}
