// ASN.1 DER, just enough to write certificates, CRLs, CMS and timestamp
// requests, and to read back certificates and timestamp responses.
// Everything is a Uint8Array of complete TLVs (tag, length, value).

export type Der = Uint8Array

function concat(parts: readonly Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function lengthBytes(length: number) {
  if (length < 0x80) return Uint8Array.of(length)
  const bytes: number[] = []
  for (let rest = length; rest > 0; rest = Math.floor(rest / 256))
    bytes.unshift(rest & 0xff)
  return Uint8Array.of(0x80 | bytes.length, ...bytes)
}

/** One TLV from a tag byte and its contents. */
export function tlv(tag: number, value: Uint8Array): Der {
  return concat([Uint8Array.of(tag), lengthBytes(value.length), value])
}

export const sequence = (...items: Der[]) => tlv(0x30, concat(items))

/** A SET OF, sorted by encoding as DER requires. */
export function set(...items: Der[]) {
  const sorted = [...items].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++)
      if (a[i] !== b[i]) return a[i] - b[i]
    return a.length - b.length
  })
  return tlv(0x31, concat(sorted))
}

/** [n] EXPLICIT: a constructed context tag wrapping complete TLVs. */
export const explicit = (n: number, ...items: Der[]) =>
  tlv(0xa0 | n, concat(items))

/** [n] IMPLICIT on a primitive: the raw contents under a context tag. */
export const implicitPrimitive = (n: number, value: Uint8Array) =>
  tlv(0x80 | n, value)

/** [n] IMPLICIT on a constructed type (a SET or SEQUENCE): retag its contents. */
export function implicitConstructed(n: number, item: Der) {
  return tlv(0xa0 | n, read(item).value)
}

export const nullValue = () => Uint8Array.of(0x05, 0x00)
export const boolean = (value: boolean) =>
  tlv(0x01, Uint8Array.of(value ? 0xff : 0))
export const octetString = (value: Uint8Array) => tlv(0x04, value)
export const utf8String = (text: string) =>
  tlv(0x0c, new TextEncoder().encode(text))
export const printableString = (text: string) =>
  tlv(0x13, new TextEncoder().encode(text))
export const ia5String = (text: string) =>
  tlv(0x16, new TextEncoder().encode(text))

/** BIT STRING with a count of unused bits in the last byte. */
export const bitString = (value: Uint8Array, unusedBits = 0) =>
  tlv(0x03, concat([Uint8Array.of(unusedBits), value]))

/** INTEGER from a non-negative bigint or the bytes of one. */
export function integer(value: bigint | number | Uint8Array) {
  let bytes: Uint8Array
  if (value instanceof Uint8Array) bytes = value
  else {
    let hex = BigInt(value).toString(16)
    if (hex.length % 2) hex = `0${hex}`
    bytes = Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)))
  }
  let start = 0
  while (
    start < bytes.length - 1 &&
    bytes[start] === 0 &&
    !(bytes[start + 1] & 0x80)
  )
    start++
  bytes = bytes.subarray(start)
  // A set top bit would read as negative.
  if (bytes[0] & 0x80) bytes = concat([Uint8Array.of(0), bytes])
  return tlv(0x02, bytes)
}

export function oid(dotted: string) {
  const parts = dotted.split(".").map(Number)
  const bytes = [parts[0] * 40 + parts[1]]
  for (const part of parts.slice(2)) {
    const chunk: number[] = []
    let rest = part
    do {
      chunk.unshift(rest & 0x7f)
      rest = Math.floor(rest / 128)
    } while (rest > 0)
    for (let i = 0; i < chunk.length - 1; i++) chunk[i] |= 0x80
    bytes.push(...chunk)
  }
  return tlv(0x06, Uint8Array.from(bytes))
}

/** UTCTime up to 2049, GeneralizedTime from 2050, as RFC 5280 asks. */
export function time(date: Date) {
  const iso = date.toISOString().replace(/[-:T]/g, "").slice(0, 14)
  return date.getUTCFullYear() < 2050
    ? tlv(0x17, new TextEncoder().encode(`${iso.slice(2)}Z`))
    : tlv(0x18, new TextEncoder().encode(`${iso}Z`))
}

export type Node = {
  tag: number
  /** The whole TLV. */
  raw: Uint8Array
  /** The contents. */
  value: Uint8Array
  children: Node[]
}

/** Parses one TLV (and its children, when constructed) at the start of bytes. */
export function read(bytes: Uint8Array): Node {
  if (bytes.length < 2) throw new Error("DER too short")
  const tag = bytes[0]
  let length = bytes[1]
  let header = 2
  if (length & 0x80) {
    const count = length & 0x7f
    if (count === 0 || count > 4) throw new Error("DER length unsupported")
    length = 0
    for (let i = 0; i < count; i++) length = length * 256 + bytes[2 + i]
    header += count
  }
  if (header + length > bytes.length) throw new Error("DER truncated")
  const raw = bytes.subarray(0, header + length)
  const value = bytes.subarray(header, header + length)
  const children: Node[] = []
  if (tag & 0x20) {
    for (let offset = 0; offset < value.length;) {
      const child = read(value.subarray(offset))
      children.push(child)
      offset += child.raw.length
    }
  }
  return { tag, raw, value, children }
}

export function readOid(node: Node) {
  if (node.tag !== 0x06) throw new Error("not an OID")
  const bytes = node.value
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40]
  let current = 0
  for (const byte of bytes.subarray(1)) {
    current = current * 128 + (byte & 0x7f)
    if (!(byte & 0x80)) {
      parts.push(current)
      current = 0
    }
  }
  return parts.join(".")
}

export function readInteger(node: Node) {
  if (node.tag !== 0x02) throw new Error("not an INTEGER")
  let value = BigInt(0)
  for (const byte of node.value) value = value * BigInt(256) + BigInt(byte)
  return value
}

export { concat }
