import {
  bitString,
  boolean,
  type Der,
  explicit,
  implicitPrimitive,
  integer,
  type Node,
  nullValue,
  octetString,
  oid,
  printableString,
  read,
  readInteger,
  readOid,
  sequence,
  set,
  time,
  tlv,
  utf8String,
} from "@/lib/pki/der"

// X.509 certificates and CRLs for the WinLab signing CA (RFC 5280), signed
// with RSASSA-PKCS1-v1_5 and SHA-256 through WebCrypto.

export const OID = {
  sha256WithRSA: "1.2.840.113549.1.1.11",
  rsaEncryption: "1.2.840.113549.1.1.1",
  sha256: "2.16.840.1.101.3.4.2.1",
  commonName: "2.5.4.3",
  organization: "2.5.4.10",
  country: "2.5.4.6",
  subjectKeyId: "2.5.29.14",
  keyUsage: "2.5.29.15",
  basicConstraints: "2.5.29.19",
  crlNumber: "2.5.29.20",
  crlDistributionPoints: "2.5.29.31",
  authorityKeyId: "2.5.29.35",
  extKeyUsage: "2.5.29.37",
  authorityInfoAccess: "1.3.6.1.5.5.7.1.1",
  caIssuers: "1.3.6.1.5.5.7.48.2",
  documentSigning: "1.3.6.1.5.5.7.3.36",
} as const

export const RSA_PARAMS = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 3072,
  publicExponent: Uint8Array.of(1, 0, 1),
  hash: "SHA-256",
} as const

const signatureAlgorithm = () => sequence(oid(OID.sha256WithRSA), nullValue())

export async function generateKeyPair() {
  return crypto.subtle.generateKey(RSA_PARAMS, true, ["sign", "verify"])
}

export async function sign(key: CryptoKey, data: Uint8Array) {
  return new Uint8Array(
    await crypto.subtle.sign(RSA_PARAMS.name, key, data as BufferSource)
  )
}

/** A Name of country, organization and common name. */
export function name(commonName: string) {
  const attribute = (type: string, value: Der) =>
    set(sequence(oid(type), value))
  return sequence(
    attribute(OID.country, printableString("TW")),
    attribute(OID.organization, utf8String("NYCU WinLab")),
    attribute(OID.commonName, utf8String(commonName))
  )
}

const extension = (type: string, critical: boolean, value: Der) =>
  critical
    ? sequence(oid(type), boolean(true), octetString(value))
    : sequence(oid(type), octetString(value))

/** SHA-1 of the subjectPublicKey bits: the usual key identifier. */
async function keyIdentifier(spki: Uint8Array) {
  const keyBits = read(spki).children[1].value.subarray(1)
  return new Uint8Array(
    await crypto.subtle.digest("SHA-1", keyBits as BufferSource)
  )
}

function randomSerial() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[0] &= 0x7f
  bytes[0] |= 0x40
  return bytes
}

export type IssueInput = {
  subject: string
  publicKey: CryptoKey
  issuer: { name: Der; key: CryptoKey; spki: Uint8Array } | "self"
  ca: boolean
  notBefore: Date
  notAfter: Date
  /** Where the issuer's CRL is published (leaf certificates). */
  crlUrl?: string
  /** Where the issuer's certificate can be downloaded (leaf certificates). */
  issuerUrl?: string
}

/** A signed certificate, DER. */
export async function issueCertificate(
  input: IssueInput,
  signingKey: CryptoKey
) {
  const spki = new Uint8Array(
    await crypto.subtle.exportKey("spki", input.publicKey)
  )
  const subject = name(input.subject)
  const issuerName = input.issuer === "self" ? subject : input.issuer.name
  const issuerSpki = input.issuer === "self" ? spki : input.issuer.spki
  const extensions = [
    input.ca
      ? extension(
          OID.basicConstraints,
          true,
          sequence(boolean(true), integer(0))
        )
      : extension(OID.basicConstraints, true, sequence()),
    // keyCertSign + cRLSign (bits 5, 6) for the CA; digitalSignature +
    // nonRepudiation (bits 0, 1) for signers.
    input.ca
      ? extension(OID.keyUsage, true, bitString(Uint8Array.of(0x06), 1))
      : extension(OID.keyUsage, true, bitString(Uint8Array.of(0xc0), 6)),
    extension(OID.subjectKeyId, false, octetString(await keyIdentifier(spki))),
    extension(
      OID.authorityKeyId,
      false,
      sequence(implicitPrimitive(0, await keyIdentifier(issuerSpki)))
    ),
  ]
  if (!input.ca)
    extensions.push(
      extension(OID.extKeyUsage, false, sequence(oid(OID.documentSigning)))
    )
  if (input.crlUrl)
    extensions.push(
      extension(
        OID.crlDistributionPoints,
        false,
        sequence(
          sequence(
            explicit(0, explicit(0, implicitPrimitive(6, encode(input.crlUrl))))
          )
        )
      )
    )
  if (input.issuerUrl)
    extensions.push(
      extension(
        OID.authorityInfoAccess,
        false,
        sequence(
          sequence(
            oid(OID.caIssuers),
            implicitPrimitive(6, encode(input.issuerUrl))
          )
        )
      )
    )
  const tbs = sequence(
    explicit(0, integer(2)),
    integer(randomSerial()),
    signatureAlgorithm(),
    issuerName,
    sequence(time(input.notBefore), time(input.notAfter)),
    subject,
    spki,
    explicit(3, sequence(...extensions))
  )
  return sequence(
    tbs,
    signatureAlgorithm(),
    bitString(await sign(signingKey, tbs))
  )
}

const encode = (text: string) => new TextEncoder().encode(text)

/** A CRL (v2) from the CA, listing revoked serials. */
export async function issueCrl(input: {
  issuer: Der
  issuerSpki: Uint8Array
  key: CryptoKey
  number: bigint
  thisUpdate: Date
  nextUpdate: Date
  revoked: { serial: bigint; at: Date }[]
}) {
  const revoked = input.revoked.length
    ? [
        sequence(
          ...input.revoked.map((entry) =>
            sequence(integer(entry.serial), time(entry.at))
          )
        ),
      ]
    : []
  const tbs = sequence(
    integer(1),
    signatureAlgorithm(),
    input.issuer,
    time(input.thisUpdate),
    time(input.nextUpdate),
    ...revoked,
    explicit(
      0,
      sequence(
        extension(
          OID.authorityKeyId,
          false,
          sequence(implicitPrimitive(0, await keyIdentifier(input.issuerSpki)))
        ),
        extension(OID.crlNumber, false, integer(input.number))
      )
    )
  )
  return sequence(
    tbs,
    signatureAlgorithm(),
    bitString(await sign(input.key, tbs))
  )
}

export type ParsedCertificate = {
  der: Uint8Array
  serial: bigint
  /** The issuer and subject Names, DER, exactly as in the certificate. */
  issuer: Uint8Array
  subject: Uint8Array
  spki: Uint8Array
  notAfter: Node
  crlUrls: string[]
  issuerUrls: string[]
}

function extensionValue(extensions: Node | undefined, type: string) {
  for (const ext of extensions?.children[0]?.children ?? []) {
    if (readOid(ext.children[0]) === type)
      return read(ext.children[ext.children.length - 1].value)
  }
  return null
}

/** Collects every [6] URI under a node. */
function uris(node: Node | null): string[] {
  if (!node) return []
  if (node.tag === 0x86) return [new TextDecoder().decode(node.value)]
  return node.children.flatMap(uris)
}

export function parseCertificate(der: Uint8Array): ParsedCertificate {
  const tbs = read(der).children[0]
  const fields =
    tbs.children[0].tag === 0xa0 ? tbs.children : [null, ...tbs.children]
  const extensions = fields.find((node) => node?.tag === 0xa3) ?? undefined
  const accessDescriptions =
    extensionValue(extensions, OID.authorityInfoAccess)?.children ?? []
  return {
    der,
    serial: readInteger(fields[1]!),
    issuer: fields[3]!.raw,
    subject: fields[5]!.raw,
    spki: fields[6]!.raw,
    notAfter: fields[4]!.children[1],
    crlUrls: uris(extensionValue(extensions, OID.crlDistributionPoints)),
    issuerUrls: accessDescriptions
      .filter((desc) => readOid(desc.children[0]) === OID.caIssuers)
      .flatMap((desc) => uris(desc.children[1])),
  }
}

export const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])

/** PEM for people to download and import. */
export function pem(der: Uint8Array, label = "CERTIFICATE") {
  const base64 = Buffer.from(der)
    .toString("base64")
    .match(/.{1,64}/g)!
    .join("\n")
  return `-----BEGIN ${label}-----\n${base64}\n-----END ${label}-----\n`
}

export { tlv }
