import { toPdf } from "@/lib/pdf-sign/convert"
import { type SignatureLevel, signDocument } from "@/lib/pdf-sign/document"
import { parseCertificate, RSA_PARAMS } from "@/lib/pki/x509"

// One upload's work for the PDF worker: convert, check the size, sign.
// Everything here touches the member's file, so it runs in the worker
// process (scripts/pdf-worker.ts), with a time and memory limit.

export type SignJob = {
  /** The upload, base64. */
  file: string
  contentType: "application/pdf" | "image/jpeg"
  /** Largest PDF accepted after conversion, in bytes. */
  maxBytes: number
  signer: { certificate: string; pkcs8: string }
  chain: string[]
  crl: string
  displayName: string
  reason: string
  appearance: { image: string; contentType: string; corner: string } | null
}

export type SignResult =
  | { ok: true; file: string; level: SignatureLevel }
  | { ok: false; error: string }

const bytes = (base64: string) => Buffer.from(base64, "base64")

export async function runSignJob(job: SignJob): Promise<SignResult> {
  try {
    const pdf = await toPdf(job.contentType, bytes(job.file))
    if (pdf.length > job.maxBytes)
      throw new Error(`轉成 PDF 後超過 ${job.maxBytes / 1024 / 1024} MB`)
    const key = await crypto.subtle.importKey(
      "pkcs8",
      bytes(job.signer.pkcs8),
      RSA_PARAMS,
      false,
      ["sign"]
    )
    const signed = await signDocument({
      pdf: new Uint8Array(pdf),
      signer: {
        certificate: parseCertificate(
          new Uint8Array(bytes(job.signer.certificate))
        ),
        key,
      },
      chain: job.chain.map((der) =>
        parseCertificate(new Uint8Array(bytes(der)))
      ),
      crl: new Uint8Array(bytes(job.crl)),
      displayName: job.displayName,
      reason: job.reason,
      appearance: job.appearance
        ? {
            image: bytes(job.appearance.image),
            contentType: job.appearance.contentType,
            corner: job.appearance.corner,
          }
        : null,
    })
    return {
      ok: true,
      file: Buffer.from(signed.bytes).toString("base64"),
      level: signed.level,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "處理失敗",
    }
  }
}
