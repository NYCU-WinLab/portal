// Writes signed sample PDFs with a throwaway CA, the same code paths an
// upload takes, for pyHanko to judge in CI (the signer must not grade its
// own work): a visible member signature, then a reviewer's on top, then the
// B-LT validation data. Output in .pades/: root.pem, signed.pdf.
import { mkdir, writeFile } from "node:fs/promises"

import { PDFDocument, StandardFonts } from "pdf-lib"

import {
  addDss,
  cmsCertificates,
  timestampToken,
  validationData,
} from "@/lib/pdf-sign/dss"
import { checkSignatureImage } from "@/lib/pdf-sign/image"
import { preparePdf } from "@/lib/pdf-sign/prepare"
import { signPdf } from "@/lib/pdf-sign/sign"
import { timestamp } from "@/lib/pki/tsa"
import {
  generateKeyPair,
  issueCertificate,
  issueCrl,
  parseCertificate,
  pem,
} from "@/lib/pki/x509"

const now = new Date()
const days = (n: number) => new Date(now.getTime() + n * 24 * 3600 * 1000)
const root = await generateKeyPair()
const rootCert = parseCertificate(
  await issueCertificate(
    {
      subject: "WinLab Portal Root CA (CI)",
      publicKey: root.publicKey,
      issuer: "self",
      ca: true,
      notBefore: now,
      notAfter: days(30),
    },
    root.privateKey
  )
)
async function member(subject: string) {
  const pair = await generateKeyPair()
  const der = await issueCertificate(
    {
      subject,
      publicKey: pair.publicKey,
      issuer: {
        name: rootCert.subject,
        key: root.privateKey,
        spki: rootCert.spki,
      },
      ca: false,
      notBefore: now,
      notAfter: days(30),
      crlUrl: "http://localhost/pki/root.crl",
      issuerUrl: "http://localhost/pki/root.crt",
    },
    root.privateKey
  )
  return { certificate: parseCertificate(der), key: pair.privateKey }
}
const uploader = await member("詹詠翔")
const reviewer = await member("Reviewer")
const crl = await issueCrl({
  issuer: rootCert.subject,
  issuerSpki: rootCert.spki,
  key: root.privateKey,
  number: BigInt(1),
  thisUpdate: now,
  nextUpdate: days(7),
  revoked: [],
})

const doc = await PDFDocument.create()
doc.addPage([595, 842]).drawText("Receipt", {
  x: 50,
  y: 780,
  size: 24,
  font: await doc.embedFont(StandardFonts.Helvetica),
})
// A 4 x 2 black-on-transparent PNG standing in for a handwritten signature.
const signaturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAYAAAB/qH1jAAAAFElEQVR4nGNgYGD4zwABMBqF8x8APeQD/ZVqETgAAAAASUVORK5CYII=",
  "base64"
)
const prepared = await preparePdf(await doc.save(), {
  image: signaturePng,
  contentType: "image/png",
  corner: "br",
})
const stamp = async (digest: Uint8Array) => (await timestamp(digest)).token
const first = await signPdf(prepared.bytes, {
  widget: prepared.widget,
  signer: uploader.certificate,
  key: uploader.key,
  chain: [rootCert],
  signerName: "詹詠翔",
  reason: "上傳至出差「CI」",
  fieldName: "Uploader",
  timestamp: stamp,
})
const second = await signPdf(first.bytes, {
  widget: null,
  signer: reviewer.certificate,
  key: reviewer.key,
  chain: [rootCert],
  signerName: "Reviewer",
  reason: "審核",
  fieldName: "Reviewer",
  timestamp: stamp,
})
const data = await validationData(
  [uploader.certificate, reviewer.certificate, rootCert],
  crl,
  [first.cms, second.cms].flatMap((cms) =>
    cmsCertificates(timestampToken(cms)!)
  )
)
// Inputs that once took the server down must now be refused quickly.
function refuses(label: string, run: () => unknown) {
  try {
    run()
  } catch (error) {
    // Only our own refusals count, not a bug in this script.
    if (error instanceof ReferenceError || error instanceof TypeError)
      throw error
    return console.log(`refused ${label}: ${(error as Error).message}`)
  }
  throw new Error(`accepted ${label}`)
}
const pngChunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  return Buffer.concat([
    length,
    Buffer.from(type, "latin1"),
    data,
    Buffer.alloc(4),
  ])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(3000, 0)
header.writeUInt32BE(3000, 4)
const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
refuses("an animated PNG signature", () =>
  checkSignatureImage(
    Buffer.concat([
      pngSignature,
      pngChunk("IHDR", header),
      pngChunk("acTL", Buffer.alloc(8)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
    "image/png"
  )
)
refuses("a PNG with a second IHDR", () =>
  checkSignatureImage(
    Buffer.concat([
      pngSignature,
      pngChunk("IHDR", Buffer.alloc(13)),
      pngChunk("IHDR", header),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
    "image/png"
  )
)
{
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [2 0 R] /Count 1 >>",
  ]
  let body = "%PDF-1.4\n"
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 3\n0000000000 65535 f\r\n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n\r\n`).join("")}trailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  const cyclic = new TextEncoder().encode(body)
  const signing = signPdf(cyclic, {
    widget: null,
    signer: uploader.certificate,
    key: uploader.key,
    chain: [rootCert],
    signerName: "x",
    reason: "x",
    fieldName: "x",
    timestamp: null,
  })
  const outcome = await signing.then(
    () => "signed",
    (error: Error) => error.message
  )
  if (outcome !== "PDF: page tree loops")
    throw new Error(`cyclic page tree: ${outcome}`)
  console.log(`refused a PDF whose page tree loops: ${outcome}`)
}

await mkdir(".pades", { recursive: true })
await writeFile(".pades/root.pem", pem(rootCert.der))
await writeFile(".pades/signed.pdf", addDss(second.bytes, data))
console.log(
  `wrote .pades/signed.pdf (${data.certificates.length} certificates, ${data.crls.length} CRLs)`
)
process.exit(0)
