"use client"

import * as React from "react"
import dynamic from "next/dynamic"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { FieldValues, type ShownField } from "./field-values"

const PdfView = dynamic(
  () => import("@/components/pdf-view").then((m) => m.PdfView),
  { ssr: false }
)

/** Text drawn into a box as a PNG: pdf-lib's standard fonts have no CJK. */
async function textImage(text: string, width: number, height: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * 2))
  canvas.height = Math.max(1, Math.round(height * 2))
  const context = canvas.getContext("2d")!
  context.fillStyle = "black"
  context.font = `${Math.min(canvas.height * 0.6, 36)}px "Noto Sans TC", sans-serif`
  context.textBaseline = "middle"
  context.fillText(text, 8, canvas.height / 2)
  const blob = await new Promise<Blob | null>((done) =>
    canvas.toBlob(done, "image/png")
  )
  return new Uint8Array(await blob!.arrayBuffer())
}

/** Any image data URL as PNG bytes, drawn through a canvas (SVG, JPG). */
async function asPng(dataUrl: string) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = image.naturalWidth || 400
  canvas.height = image.naturalHeight || 200
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((done) =>
    canvas.toBlob(done, "image/png")
  )
  return new Uint8Array(await blob!.arrayBuffer())
}

// A sent or finished document with what everyone filled in, and the PDF
// with those values drawn in to download.
export function DocView({
  title,
  file,
  fields,
}: {
  title: string
  file: string
  fields: ShownField[]
}) {
  const [page, setPage] = React.useState(1)
  const [busy, setBusy] = React.useState(false)

  async function download() {
    setBusy(true)
    try {
      const { PDFDocument } = await import("pdf-lib")
      const pdf = await PDFDocument.load(
        await (await fetch(file)).arrayBuffer()
      )
      const pages = pdf.getPages()
      for (const f of fields) {
        const target = pages[f.page - 1]
        if (!f.value || !target) continue
        const { width: pw, height: ph } = target.getSize()
        const box = {
          x: f.x * pw,
          y: ph - (f.y + f.height) * ph,
          width: f.width * pw,
          height: f.height * ph,
        }
        const signature =
          f.category === "signature" && f.value.startsWith("data:image/")
        const image = !signature
          ? await pdf.embedPng(await textImage(f.value, box.width, box.height))
          : f.value.startsWith("data:image/png")
            ? await pdf.embedPng(f.value)
            : f.value.startsWith("data:image/jpeg")
              ? await pdf.embedJpg(f.value)
              : await pdf.embedPng(await asPng(f.value))
        target.drawImage(image, box)
      }
      const bytes = await pdf.save()
      const url = URL.createObjectURL(
        new Blob([bytes.slice().buffer], { type: "application/pdf" })
      )
      const a = document.createElement("a")
      a.href = url
      a.download = `${title}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "下載失敗")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="outline"
        className="self-start"
        disabled={busy}
        onClick={download}
      >
        {busy ? "準備中…" : "下載 PDF"}
      </Button>
      <PdfView file={file} page={page} onPageChange={setPage}>
        {(size) => <FieldValues fields={fields} page={page} size={size} />}
      </PdfView>
    </div>
  )
}
