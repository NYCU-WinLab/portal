"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Document, Page, pdfjs } from "react-pdf"

import { Button } from "@/components/ui/button"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString()

export type PageSize = { width: number; height: number }

// One page of a PDF at the width of its container, with an overlay drawn in
// the page's own pixels: an svg sized to the page, so boxes stored as
// fractions of the page land where they belong at any width.
function PdfView({
  file,
  page,
  onPageChange,
  onPages,
  children,
}: {
  file: string
  page: number
  onPageChange: (page: number) => void
  onPages?: (count: number) => void
  /** The overlay, given the page's size in px. */
  children?: (size: PageSize) => React.ReactNode
}) {
  const box = React.useRef<HTMLDivElement>(null)
  const [width, setWidth] = React.useState(0)
  const [pages, setPages] = React.useState(0)
  const [size, setSize] = React.useState<PageSize | null>(null)

  React.useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(() =>
      setWidth(Math.min(900, Math.floor(el.clientWidth)))
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={box} className="flex w-full flex-col items-center gap-4">
      <div className="relative overflow-hidden rounded-control border border-border">
        {width > 0 && (
          <Document
            file={file}
            loading={<p className="p-6 text-muted-foreground">載入 PDF…</p>}
            error={<p className="p-6 text-destructive">讀不到這份 PDF</p>}
            onLoadSuccess={({ numPages }) => {
              setPages(numPages)
              onPages?.(numPages)
            }}
          >
            <Page
              pageNumber={page}
              width={width}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              onLoadSuccess={(p) =>
                setSize({ width: p.width, height: p.height })
              }
            />
          </Document>
        )}
        {size && children && (
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${size.width} ${size.height}`}
          >
            {children(size)}
          </svg>
        )}
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            aria-label="上一頁"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <span className="text-muted-foreground tabular-nums">
            {page} / {pages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下一頁"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      )}
    </div>
  )
}

export { PdfView }
