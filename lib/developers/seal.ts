// Seals each application's Keycloak registration access token at rest
// (AES-256-GCM, key from DEVELOPERS_SECRET, 32 random bytes in base64).
// Losing the secret leaves the clients in Keycloak unmanageable by portal
// until a realm admin issues new registration tokens.

import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

function key() {
  const secret = process.env.DEVELOPERS_SECRET
  if (!secret) throw new Error("DEVELOPERS_SECRET is not set")
  const raw = Buffer.from(secret, "base64")
  if (raw.length < 32)
    throw new Error("DEVELOPERS_SECRET needs 32 bytes or more")
  return Buffer.from(hkdfSync("sha256", raw, "", "portal-developers-rat", 32))
}

/** v1.<iv>.<ciphertext+tag>, base64url. */
export function seal(plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
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
    key(),
    Buffer.from(iv, "base64url")
  )
  decipher.setAuthTag(raw.subarray(raw.length - 16))
  return Buffer.concat([
    decipher.update(raw.subarray(0, raw.length - 16)),
    decipher.final(),
  ]).toString("utf8")
}
