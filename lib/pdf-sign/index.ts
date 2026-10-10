import {
  currentCrl,
  memberIdentity,
  rootIdentity,
} from "@/lib/actions/signing-keys"
import { signDocument } from "@/lib/pdf-sign/document"

export type { SignatureLevel } from "@/lib/pdf-sign/document"

// Signs an upload for the member who uploaded it, with their WinLab
// certificate (issued on first use); see lib/pdf-sign/document.ts.
export async function signUpload(input: {
  pdf: Uint8Array
  userId: string
  displayName: string
  reason: string
  appearance: { image: Buffer; contentType: string; corner: string } | null
}) {
  const [member, root, crl] = await Promise.all([
    memberIdentity(input.userId, input.displayName),
    rootIdentity(),
    currentCrl(),
  ])
  return signDocument({
    pdf: input.pdf,
    signer: member,
    chain: [root.certificate],
    crl,
    displayName: input.displayName,
    reason: input.reason,
    appearance: input.appearance,
  })
}
