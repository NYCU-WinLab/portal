import {
  boolean,
  integer,
  nullValue,
  octetString,
  oid,
  read,
  readInteger,
  sequence,
} from "@/lib/pki/der"
import { OID } from "@/lib/pki/x509"

// RFC 3161 timestamps from public authorities, tried in order. A token
// proves the signature existed at that time, from a party other than us.

export const TSA_URLS = [
  "http://timestamp.digicert.com",
  "http://timestamp.sectigo.com",
  "http://timestamp.globalsign.com/tsa/r6advanced1",
  "http://time.certum.pl",
]

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

/** The TimeStampToken (a CMS ContentInfo, DER) for a SHA-256 digest. */
async function requestFrom(url: string, digest: Uint8Array) {
  const nonce = crypto.getRandomValues(new Uint8Array(8))
  nonce[0] &= 0x7f
  const request = sequence(
    integer(1),
    sequence(sequence(oid(OID.sha256), nullValue()), octetString(digest)),
    integer(nonce),
    boolean(true)
  )
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/timestamp-query" },
    body: request as BodyInit,
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const body = read(new Uint8Array(await response.arrayBuffer()))
  const status = readInteger(body.children[0].children[0])
  if (status > BigInt(1) || !body.children[1])
    throw new Error(`${url} refused the request (status ${status})`)
  const token = body.children[1]
  // token → SignedData → encapContentInfo → [0] → OCTET STRING → TSTInfo
  const signedData = token.children[1].children[0]
  const encap = signedData.children.find(
    (node) => node.tag === 0x30 && node.children[1]?.tag === 0xa0
  )
  const tstInfo = read(encap!.children[1].children[0].value)
  const imprint = tstInfo.children[2].children[1].value
  if (!sameBytes(imprint, digest))
    throw new Error(`${url} stamped another digest`)
  const tokenNonce = tstInfo.children.find(
    (node, i) => i > 4 && node.tag === 0x02
  )
  if (
    !tokenNonce ||
    readInteger(tokenNonce) !== readInteger(read(integer(nonce)))
  )
    throw new Error(`${url} returned another nonce`)
  return token.raw
}

/** A token from the first authority that answers well. */
export async function timestamp(digest: Uint8Array) {
  const failures: string[] = []
  for (const url of TSA_URLS) {
    try {
      return { url, token: await requestFrom(url, digest) }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`no timestamp authority answered: ${failures.join("; ")}`)
}
