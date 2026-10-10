import {
  currentCrl,
  memberIdentity,
  rootIdentity,
} from "@/lib/actions/signing-keys"
import { timestamp } from "@/lib/pki/tsa"
import {
  addDss,
  cmsCertificates,
  timestampToken,
  validationData,
} from "@/lib/pdf-sign/dss"
import { checkSignatureImage } from "@/lib/pdf-sign/image"
import { type Corner, preparePdf } from "@/lib/pdf-sign/prepare"
import { signPdf } from "@/lib/pdf-sign/sign"

// Signs an uploaded PDF for the member who uploaded it: normalized, a
// PAdES signature by their WinLab certificate (with their handwritten
// signature in a corner when they chose to show it), an RFC 3161 timestamp,
// then the validation data for B-LT. Without any timestamp authority
// answering it stays B-B rather than failing the upload.

export type SignatureLevel = "B-B" | "B-LT"

export async function signUpload(input: {
  pdf: Uint8Array
  userId: string
  displayName: string
  reason: string
  appearance: { image: Buffer; contentType: string; corner: string } | null
}): Promise<{ bytes: Uint8Array; level: SignatureLevel }> {
  if (input.appearance)
    checkSignatureImage(input.appearance.image, input.appearance.contentType)
  const [member, root] = await Promise.all([
    memberIdentity(input.userId, input.displayName),
    rootIdentity(),
  ])
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
  let stamped = true
  const options = {
    widget: prepared.widget,
    signer: member.certificate,
    key: member.key,
    chain: [root.certificate],
    signerName: input.displayName,
    reason: input.reason,
    fieldName: "Uploader",
  }
  let signed
  try {
    signed = await signPdf(prepared.bytes, {
      ...options,
      timestamp: async (digest) => (await timestamp(digest)).token,
    })
  } catch (error) {
    if (!(error instanceof Error && error.message.startsWith("no timestamp")))
      throw error
    console.error("timestamp", error.message)
    stamped = false
    signed = await signPdf(prepared.bytes, { ...options, timestamp: null })
  }
  const token = stamped ? timestampToken(signed.cms) : null
  const data = await validationData(
    [member.certificate, root.certificate],
    await currentCrl(),
    token ? cmsCertificates(token) : []
  )
  return {
    bytes: addDss(signed.bytes, data),
    level: stamped ? "B-LT" : "B-B",
  }
}
