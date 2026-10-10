import {
  currentCrl,
  memberSigningMaterial,
  rootIdentity,
} from "@/lib/actions/signing-keys"
import { signIsolated } from "@/lib/pdf-sign/isolated"

export type { SignatureLevel } from "@/lib/pdf-sign/document"

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

// Converts and signs an upload for the member who uploaded it, with their
// WinLab certificate (issued on first use). The work on the file itself
// happens in the PDF worker (lib/pdf-sign/isolated.ts); errors it reports
// are for the member to read.
export async function signUpload(input: {
  file: Uint8Array
  contentType: "application/pdf" | "image/jpeg"
  maxBytes: number
  userId: string
  displayName: string
  reason: string
  appearance: { image: Buffer; contentType: string; corner: string } | null
}) {
  const [member, root, crl] = await Promise.all([
    memberSigningMaterial(input.userId, input.displayName),
    rootIdentity(),
    currentCrl(),
  ])
  const result = await signIsolated({
    file: b64(input.file),
    contentType: input.contentType,
    maxBytes: input.maxBytes,
    signer: { certificate: b64(member.certificate), pkcs8: b64(member.pkcs8) },
    chain: [b64(root.certificate.der)],
    crl: b64(crl),
    displayName: input.displayName,
    reason: input.reason,
    appearance: input.appearance
      ? {
          image: b64(input.appearance.image),
          contentType: input.appearance.contentType,
          corner: input.appearance.corner,
        }
      : null,
  })
  if (!result.ok) throw new Error(result.error)
  return {
    bytes: new Uint8Array(Buffer.from(result.file, "base64")),
    level: result.level,
  }
}
