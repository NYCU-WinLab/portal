import { signedData } from "@/lib/pki/cms"
import type { ParsedCertificate } from "@/lib/pki/x509"

import {
  array,
  dict,
  firstPage,
  getDict,
  getObject,
  Increment,
  name,
  num,
  parsePdf,
  type PdfValue,
  ref,
  resolve,
  rootRef,
  text,
} from "@/lib/pdf-sign/pdf"

// One PAdES signature as an incremental update: a signature dictionary
// with room for the CMS, a signature field that is also its widget (with
// the prepared appearance, or none), the page's annotation list and the
// document's AcroForm. The ByteRange covers every byte except the hex in
// /Contents; the CMS signs exactly those bytes.

/** Bytes kept for the CMS in /Contents: the timestamp token is the bulk. */
const CONTENTS_BYTES = 24 * 1024
const BYTE_RANGE_PLACEHOLDER = "[0 ********** ********** **********]"

function pdfDate(date: Date) {
  return `D:${date.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`
}

export async function signPdf(
  input: Uint8Array,
  options: {
    widget: { appearance: number; rect: number[] } | null
    signer: ParsedCertificate
    key: CryptoKey
    chain: ParsedCertificate[]
    signerName: string
    reason: string
    fieldName: string
    timestamp: ((digest: Uint8Array) => Promise<Uint8Array>) | null
    now?: Date
  }
) {
  const pdf = parsePdf(input)
  const increment = new Increment(pdf)
  const page = firstPage(pdf)
  const catalogN = rootRef(pdf)
  const catalog = new Map(getDict(pdf, ref(catalogN)))

  const signatureN = increment.reserve()
  const fieldN = increment.reserve()

  let appearance = options.widget?.appearance
  if (appearance === undefined)
    appearance = increment.add(
      dict({
        Type: name("XObject"),
        Subtype: name("Form"),
        BBox: array(num(0), num(0), num(0), num(0)),
      }),
      new Uint8Array()
    )
  increment.set(
    fieldN,
    dict({
      Type: name("Annot"),
      Subtype: name("Widget"),
      FT: name("Sig"),
      T: text(options.fieldName),
      V: ref(signatureN),
      // Print + Locked
      F: num(132),
      P: ref(page.n),
      Rect: array(...(options.widget?.rect ?? [0, 0, 0, 0]).map(num)),
      AP: dict({ N: ref(appearance) }),
    })
  )

  // The page lists the widget among its annotations.
  const pageDict = new Map(page.dict)
  const annots = pageDict.get("Annots")
  if (annots?.t === "ref") {
    const list = getObject(pdf, annots.n)
    if (list.t !== "array") throw new Error("PDF: /Annots is not an array")
    increment.set(annots.n, array(...list.items, ref(fieldN)))
  } else {
    pageDict.set(
      "Annots",
      array(...(annots?.t === "array" ? annots.items : []), ref(fieldN))
    )
    increment.set(page.n, { t: "dict", entries: pageDict })
  }

  // The document's form lists the field; SigFlags 3 = has signatures,
  // append only.
  const acroForm = catalog.get("AcroForm")
  const formDict = new Map(acroForm ? getDict(pdf, acroForm) : [])
  const fields = resolve(pdf, formDict.get("Fields"))
  formDict.set(
    "Fields",
    array(...(fields?.t === "array" ? fields.items : []), ref(fieldN))
  )
  formDict.set("SigFlags", num(3))
  if (acroForm?.t === "ref")
    increment.set(acroForm.n, { t: "dict", entries: formDict })
  else {
    catalog.set("AcroForm", { t: "dict", entries: formDict })
    increment.set(catalogN, { t: "dict", entries: catalog })
  }

  const contents: PdfValue = {
    t: "str",
    raw: `<${"0".repeat(CONTENTS_BYTES * 2)}>`,
  }
  const byteRange: PdfValue = { t: "str", raw: BYTE_RANGE_PLACEHOLDER }
  increment.set(
    signatureN,
    dict({
      Type: name("Sig"),
      Filter: name("Adobe.PPKLite"),
      SubFilter: name("ETSI.CAdES.detached"),
      ByteRange: byteRange,
      Contents: contents,
      M: text(pdfDate(options.now ?? new Date())),
      Name: text(options.signerName),
      Reason: text(options.reason),
    })
  )

  const file = Buffer.from(increment.build())
  const s = file.toString("latin1")
  const rangeAt = s.lastIndexOf(BYTE_RANGE_PLACEHOLDER)
  const contentsAt = s.indexOf("/Contents <", rangeAt) + "/Contents ".length
  const contentsEnd = contentsAt + CONTENTS_BYTES * 2 + 2
  const ranges = [0, contentsAt, contentsEnd, file.length - contentsEnd]
  const rangeText = `[${ranges.join(" ")}]`.padEnd(
    BYTE_RANGE_PLACEHOLDER.length,
    " "
  )
  file.write(rangeText, rangeAt, "latin1")

  const covered = Buffer.concat([
    file.subarray(0, contentsAt),
    file.subarray(contentsEnd),
  ])
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", covered as BufferSource)
  )
  const cms = await signedData({
    digest,
    signer: options.signer,
    key: options.key,
    chain: options.chain,
    timestamp: options.timestamp,
  })
  if (cms.length > CONTENTS_BYTES)
    throw new Error(
      `signature is ${cms.length} bytes, room for ${CONTENTS_BYTES}`
    )
  file.write(Buffer.from(cms).toString("hex"), contentsAt + 1, "latin1")
  return { bytes: new Uint8Array(file), cms }
}
