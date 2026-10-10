import { toPdf } from "@/lib/pdf-sign/convert"
import { stampPdf } from "@/lib/pdf-sign/stamp"

// One upload's work for the PDF worker: convert, check the size, stamp the
// member's signature. Everything here touches the member's file, so it
// runs in the worker process (scripts/pdf-worker.ts), with a time and
// memory limit.

export type UploadJob = {
  /** The upload, base64. */
  file: string
  contentType: "application/pdf" | "image/jpeg"
  /** Largest PDF accepted, in bytes. */
  maxBytes: number
  signature: { image: string; contentType: string; corner: string } | null
}

export type UploadResult =
  { ok: true; file: string; stamped: boolean } | { ok: false; error: string }

export async function runUploadJob(job: UploadJob): Promise<UploadResult> {
  try {
    let pdf: Uint8Array = await toPdf(
      job.contentType,
      Buffer.from(job.file, "base64")
    )
    if (job.signature)
      pdf = await stampPdf(pdf, {
        image: Buffer.from(job.signature.image, "base64"),
        contentType: job.signature.contentType,
        corner: job.signature.corner,
      })
    if (pdf.length > job.maxBytes)
      throw new Error(`轉成 PDF 後超過 ${job.maxBytes / 1024 / 1024} MB`)
    return {
      ok: true,
      file: Buffer.from(pdf).toString("base64"),
      stamped: job.signature !== null,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "處理失敗",
    }
  }
}
