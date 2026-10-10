import { PDFDocument } from "pdf-lib"

import { checkSignatureImage } from "@/lib/pdf-sign/image"

// The member's handwritten signature, drawn into a corner of page 1 of
// what they upload. A picture, not a cryptographic signature: nobody
// verifies certificates for receipts, and one can come back if that
// changes (git history has a PAdES signer).

const WIDTH = 140
const MAX_HEIGHT = 56
const MARGIN = 24

export async function stampPdf(
  input: Uint8Array,
  signature: { image: Buffer; contentType: string; corner: string }
) {
  checkSignatureImage(signature.image, signature.contentType)
  const pdf = await PDFDocument.load(input, { updateMetadata: false })
  // A copy: pdf-lib reads the ArrayBuffer from offset 0, and Node keeps
  // small Buffers inside a shared pool.
  const bytes = new Uint8Array(signature.image)
  const image =
    signature.contentType === "image/png"
      ? await pdf.embedPng(bytes)
      : await pdf.embedJpg(bytes)
  let width = WIDTH
  let height = (WIDTH * image.height) / image.width
  if (height > MAX_HEIGHT) {
    width = (width * MAX_HEIGHT) / height
    height = MAX_HEIGHT
  }
  const page = pdf.getPage(0)
  const box = page.getMediaBox()
  const left = signature.corner.endsWith("l")
  const top = signature.corner.startsWith("t")
  page.drawImage(image, {
    x: left ? box.x + MARGIN : box.x + box.width - MARGIN - width,
    y: top ? box.y + box.height - MARGIN - height : box.y + MARGIN,
    width,
    height,
  })
  return pdf.save()
}
