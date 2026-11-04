// Two keys from CALENDAR_SECRET (32 random bytes, base64): one seals Google
// refresh tokens at rest (AES-256-GCM), one signs subscription links (HMAC).
// Losing the secret means every member links Google again; changing it also
// ends every subscription link.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto"

function key(purpose: string) {
  const secret = process.env.CALENDAR_SECRET
  if (!secret) throw new Error("行事曆沒有設定 CALENDAR_SECRET")
  const raw = Buffer.from(secret, "base64")
  if (raw.length < 32) throw new Error("CALENDAR_SECRET 要 32 bytes 以上")
  return Buffer.from(
    hkdfSync("sha256", raw, "", `portal-calendar-${purpose}`, 32)
  )
}

/** v1.<iv>.<ciphertext+tag>, base64url. */
export function seal(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key("seal"), iv)
  const body = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ])
  return `v1.${iv.toString("base64url")}.${body.toString("base64url")}`
}

export function open(sealed: string) {
  const [version, iv, body] = sealed.split(".")
  if (version !== "v1" || !iv || !body) throw new Error("sealed token format")
  const raw = Buffer.from(body, "base64url")
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key("seal"),
    Buffer.from(iv, "base64url")
  )
  decipher.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([
    decipher.update(raw.subarray(0, raw.length - 16)),
    decipher.final(),
  ]).toString("utf8")
}

/** The key in a member's subscription links, for one link version. */
export const feedKey = (viewerId: string, version: number) =>
  createHmac("sha256", key("feed"))
    .update(`${viewerId}:${version}`)
    .digest("base64url")

export function sameKey(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
