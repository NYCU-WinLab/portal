import { read } from "@/lib/pki/der"
import {
  type ParsedCertificate,
  parseCertificate,
  sameBytes,
} from "@/lib/pki/x509"

import {
  array,
  dict,
  getDict,
  Increment,
  name,
  parsePdf,
  ref,
  rootRef,
} from "@/lib/pdf-sign/pdf"

// PAdES B-LT: an incremental update adding a Document Security Store with
// every certificate and CRL a validator needs, for the signer's chain and
// the timestamp authority's, so the signature can be checked long after
// those certificates expire or their servers go away.

/** The certificates inside a CMS SignedData (a signature or a timestamp token). */
export function cmsCertificates(cms: Uint8Array): ParsedCertificate[] {
  const signedData = read(cms).children[1].children[0]
  const certificates = signedData.children.find((node) => node.tag === 0xa0)
  return (certificates?.children ?? []).map((node) =>
    parseCertificate(node.raw)
  )
}

/** The timestamp token in a signature's unsigned attributes, if any. */
export function timestampToken(cms: Uint8Array) {
  const signedData = read(cms).children[1].children[0]
  const signerInfo = signedData.children.at(-1)!.children[0]
  const unsigned = signerInfo.children.find((node) => node.tag === 0xa1)
  return unsigned?.children[0]?.children[1]?.children[0]?.raw ?? null
}

async function fetchBytes(url: string) {
  if (!/^https?:\/\//.test(url)) throw new Error(`not http: ${url}`)
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/** PEM or DER from a download, as DER. */
function toDer(bytes: Uint8Array) {
  const text = Buffer.from(bytes).toString("latin1")
  const match = /-----BEGIN [^-]+-----([\s\S]+?)-----END/.exec(text)
  return match
    ? new Uint8Array(Buffer.from(match[1].replace(/\s/g, ""), "base64"))
    : bytes
}

/**
 * Completes the timestamp authority's chain (certificates the token leaves
 * out are fetched from their issuers' AIA URLs) and fetches a CRL for every
 * certificate that is not a root.
 */
export async function validationData(
  ownChain: ParsedCertificate[],
  ownCrl: Uint8Array,
  tsaCertificates: ParsedCertificate[]
) {
  const certificates = [...ownChain]
  const crls: Uint8Array[] = [ownCrl]
  const queue = [...tsaCertificates]
  const has = (cert: ParsedCertificate) =>
    certificates.some((other) => sameBytes(other.der, cert.der))
  while (queue.length) {
    const cert = queue.shift()!
    if (has(cert)) continue
    certificates.push(cert)
    if (sameBytes(cert.issuer, cert.subject)) continue
    const issuerKnown = [...certificates, ...queue].some((other) =>
      sameBytes(other.subject, cert.issuer)
    )
    if (!issuerKnown)
      for (const url of cert.issuerUrls) {
        try {
          queue.push(parseCertificate(toDer(await fetchBytes(url))))
          break
        } catch {}
      }
    for (const url of cert.crlUrls) {
      try {
        crls.push(toDer(await fetchBytes(url)))
        break
      } catch {}
    }
  }
  return { certificates, crls }
}

export function addDss(
  input: Uint8Array,
  data: { certificates: ParsedCertificate[]; crls: Uint8Array[] }
) {
  const pdf = parsePdf(input)
  const increment = new Increment(pdf)
  const catalogN = rootRef(pdf)
  const catalog = new Map(getDict(pdf, ref(catalogN)))
  const certs = data.certificates.map((cert) =>
    increment.add(dict({}), cert.der)
  )
  const crls = data.crls.map((crl) => increment.add(dict({}), crl))
  const dss = increment.add(
    dict({
      Type: name("DSS"),
      Certs: array(...certs.map(ref)),
      CRLs: array(...crls.map(ref)),
    })
  )
  catalog.set("DSS", ref(dss))
  increment.set(catalogN, { t: "dict", entries: catalog })
  return increment.build()
}
