import { PDFDocument } from "pdf-lib"

import type { ParsedCertificate } from "@/lib/pki/x509"
import { addAppearance } from "@/lib/pdf-sign/appearance"
import {
  addDss,
  cmsCertificates,
  timestampToken,
  validationData,
} from "@/lib/pdf-sign/dss"
import { checkSignatureImage } from "@/lib/pdf-sign/image"
import {
  getDict,
  parsePdf,
  type Pdf,
  type PdfValue,
  ref,
  resolve,
  rootRef,
} from "@/lib/pdf-sign/pdf"
import { type Corner, preparePdf } from "@/lib/pdf-sign/prepare"
import { signPdf } from "@/lib/pdf-sign/sign"
import { timestamp } from "@/lib/pki/tsa"

// Signs an uploaded PDF for the member who uploaded it: a PAdES signature
// by their WinLab certificate (with their handwritten signature in a
// corner when they chose to show it), an RFC 3161 timestamp, then the
// validation data for B-LT. Without any timestamp authority answering it
// stays B-B rather than failing the upload.
//
// A PDF someone already signed is not re-saved: ours is appended to the
// original bytes so their signature stays valid. Under a certification
// that allows form filling and signing only (DocMDP P=2) ours is
// invisible: a new visible widget counts as an annotation, which P=2
// does not allow. If the file declares a certification that allows no
// changes at all (P=1) it is stored as uploaded without our signature
// ("kept"); the file only claims this, so pages say plainly that the
// portal did not sign it. Anything our reader can't follow is signed the
// plain way (re-saved).

export type SignatureLevel = "B-B" | "B-LT" | "kept"

type Existing = {
  signed: boolean
  /** The certification's DocMDP permission level, if any. */
  permission: number | null
}

const nameOf = (value: PdfValue | undefined) =>
  value?.t === "name" ? value.v : undefined

/** Whether the file carries a filled signature field, and whether a
 * certification signature forbids any change. */
function inspect(pdf: Pdf): Existing {
  const catalog = getDict(pdf, ref(rootRef(pdf)))
  let permission: number | null = null
  const perms = resolve(pdf, catalog.get("Perms"))
  const docMdp =
    perms?.t === "dict" ? resolve(pdf, perms.entries.get("DocMDP")) : undefined
  if (docMdp?.t === "dict") {
    const references = resolve(pdf, docMdp.entries.get("Reference"))
    for (const item of references?.t === "array" ? references.items : []) {
      const reference = resolve(pdf, item)
      if (reference?.t !== "dict") continue
      if (nameOf(reference.entries.get("TransformMethod")) !== "DocMDP")
        continue
      const params = resolve(pdf, reference.entries.get("TransformParams"))
      const p = params?.t === "dict" ? params.entries.get("P") : undefined
      // P defaults to 2 when absent.
      permission = p?.t === "num" ? Number(p.v) : 2
    }
  }
  const form = resolve(pdf, catalog.get("AcroForm"))
  const fields =
    form?.t === "dict" ? resolve(pdf, form.entries.get("Fields")) : undefined
  let signed = docMdp !== undefined
  const queue: PdfValue[] = fields?.t === "array" ? [...fields.items] : []
  for (let visited = 0; queue.length && visited < 2000 && !signed; visited++) {
    const field = resolve(pdf, queue.shift())
    if (field?.t !== "dict") continue
    if (nameOf(field.entries.get("FT")) === "Sig" && field.entries.has("V"))
      signed = true
    const kids = resolve(pdf, field.entries.get("Kids"))
    if (kids?.t === "array") queue.push(...kids.items)
  }
  return { signed, permission }
}

export async function signDocument(input: {
  pdf: Uint8Array
  signer: { certificate: ParsedCertificate; key: CryptoKey }
  chain: ParsedCertificate[]
  /** The signer's CA's current CRL, for the B-LT validation data. */
  crl: Uint8Array
  displayName: string
  reason: string
  appearance: { image: Buffer; contentType: string; corner: string } | null
  /** Gets a timestamp token; defaults to the public authorities. */
  timestamp?: (digest: Uint8Array) => Promise<Uint8Array>
}): Promise<{ bytes: Uint8Array; level: SignatureLevel }> {
  if (input.appearance)
    checkSignatureImage(input.appearance.image, input.appearance.contentType)

  /** Signs on top of base: timestamp (B-B without one), then B-LT data. */
  const signOn = async (
    base: Uint8Array,
    page: number,
    widget: { appearance: number; rect: number[] } | null,
    drawAppearance?: Parameters<typeof signPdf>[1]["drawAppearance"]
  ): Promise<{ bytes: Uint8Array; level: SignatureLevel }> => {
    const options = {
      widget,
      drawAppearance,
      page,
      signer: input.signer.certificate,
      key: input.signer.key,
      chain: input.chain,
      signerName: input.displayName,
      reason: input.reason,
      fieldName: "WinLabUploader",
    }
    let stamped = true
    let signed
    try {
      signed = await signPdf(base, {
        ...options,
        timestamp:
          input.timestamp ??
          (async (digest) => (await timestamp(digest)).token),
      })
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith("no timestamp")))
        throw error
      console.error("timestamp", error.message)
      stamped = false
      signed = await signPdf(base, { ...options, timestamp: null })
    }
    const token = stamped ? timestampToken(signed.cms) : null
    const data = await validationData(
      [input.signer.certificate, ...input.chain],
      input.crl,
      token ? cmsCertificates(token) : []
    )
    return {
      bytes: addDss(signed.bytes, data),
      level: stamped ? "B-LT" : "B-B",
    }
  }

  // Signed already? Read with our own parser; pdf-lib would only tell us
  // after re-saving. A file our reader can't follow is signed the plain
  // way below (re-saved): every upload carries the portal's signature,
  // and "kept" means only a verified no-changes certification.
  let existing: Existing = { signed: false, permission: null }
  if (Buffer.from(input.pdf).includes("/ByteRange")) {
    try {
      existing = inspect(parsePdf(input.pdf))
    } catch (error) {
      console.error("existing signature unreadable", (error as Error).message)
    }
    if (existing.permission === 1) return { bytes: input.pdf, level: "kept" }
  }

  if (existing.signed) {
    try {
      const page = (
        await PDFDocument.load(input.pdf, { updateMetadata: false })
      ).getPage(0).ref.objectNumber
      const image = existing.permission === 2 ? null : input.appearance
      return await signOn(
        input.pdf,
        page,
        null,
        image
          ? (increment, mediaBox) =>
              addAppearance(
                increment,
                {
                  data: image.image,
                  contentType: image.contentType,
                  corner: image.corner,
                },
                mediaBox
              )
          : undefined
      )
    } catch (error) {
      console.error("appending to a signed PDF", (error as Error).message)
    }
  }

  const prepared = await preparePdf(
    input.pdf,
    input.appearance
      ? {
          image: input.appearance.image,
          contentType: input.appearance.contentType,
          corner: input.appearance.corner as Corner,
        }
      : null
  )
  return signOn(prepared.bytes, prepared.page, prepared.widget)
}
