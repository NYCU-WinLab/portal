import { processIsolated } from "@/lib/pdf-sign/isolated"

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")

// Converts an upload to PDF and stamps the member's signature on it, in
// the PDF worker (lib/pdf-sign/isolated.ts); errors it reports are for the
// member to read.
export async function processUpload(input: {
  file: Uint8Array
  contentType: "application/pdf" | "image/jpeg"
  maxBytes: number
  signature: { image: Buffer; contentType: string; corner: string } | null
}) {
  const result = await processIsolated({
    file: b64(input.file),
    contentType: input.contentType,
    maxBytes: input.maxBytes,
    signature: input.signature
      ? {
          image: b64(input.signature.image),
          contentType: input.signature.contentType,
          corner: input.signature.corner,
        }
      : null,
  })
  if (!result.ok) throw new Error(result.error)
  return {
    bytes: new Uint8Array(Buffer.from(result.file, "base64")),
    stamped: result.stamped,
  }
}
