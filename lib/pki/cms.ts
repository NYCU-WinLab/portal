import {
  type Der,
  concat,
  explicit,
  implicitConstructed,
  integer,
  nullValue,
  octetString,
  oid,
  sequence,
  set,
} from "@/lib/pki/der"
import { OID, type ParsedCertificate, sign } from "@/lib/pki/x509"

// CMS SignedData for a PAdES signature (ETSI EN 319 142-1, SubFilter
// ETSI.CAdES.detached): detached content, the signer's certificate pinned
// by signing-certificate-v2, no signing-time (PAdES puts the claimed time
// in the signature dictionary's /M), and an RFC 3161 timestamp over the
// signature value as an unsigned attribute.

const CMS = {
  data: "1.2.840.113549.1.7.1",
  signedData: "1.2.840.113549.1.7.2",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  timeStampToken: "1.2.840.113549.1.9.16.2.14",
} as const

const attribute = (type: string, value: Der) => sequence(oid(type), set(value))

const sha256 = async (data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource))

export async function signedData(input: {
  /** SHA-256 of the bytes the PDF's ByteRange covers. */
  digest: Uint8Array
  signer: ParsedCertificate
  key: CryptoKey
  /** The rest of the chain, signer first excluded. */
  chain: ParsedCertificate[]
  /** Gets a TimeStampToken for a digest of the signature value; null for none. */
  timestamp: ((digest: Uint8Array) => Promise<Der>) | null
}) {
  const signedAttributes = set(
    attribute(CMS.contentType, oid(CMS.data)),
    attribute(CMS.messageDigest, octetString(input.digest)),
    attribute(
      CMS.signingCertificateV2,
      // SigningCertificateV2 { certs { ESSCertIDv2 { certHash } } };
      // the hash algorithm defaults to SHA-256 and is left out.
      sequence(sequence(sequence(octetString(await sha256(input.signer.der)))))
    )
  )
  const signature = await sign(input.key, signedAttributes)
  const unsigned = input.timestamp
    ? [
        implicitConstructed(
          1,
          set(
            attribute(
              CMS.timeStampToken,
              await input.timestamp(await sha256(signature))
            )
          )
        ),
      ]
    : []
  const signerInfo = sequence(
    integer(1),
    sequence(input.signer.issuer, integer(input.signer.serial)),
    sequence(oid(OID.sha256)),
    implicitConstructed(0, signedAttributes),
    sequence(oid(OID.sha256WithRSA), nullValue()),
    octetString(signature),
    ...unsigned
  )
  const certificates = explicit(
    0,
    ...[input.signer, ...input.chain].map((cert) => cert.der)
  )
  return sequence(
    oid(CMS.signedData),
    explicit(
      0,
      sequence(
        integer(1),
        set(sequence(oid(OID.sha256))),
        sequence(oid(CMS.data)),
        certificates,
        set(signerInfo)
      )
    )
  )
}

export { concat }
