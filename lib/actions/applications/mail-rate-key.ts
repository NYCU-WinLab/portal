import { hkdfSync } from "node:crypto"

/**
 * The HMAC key for the mail rate-limit log, derived from BETTER_AUTH_SECRET
 * so no second secret is needed. Rotating BETTER_AUTH_SECRET changes the key,
 * which only resets that history. Read when a mail is reserved, not at start.
 */
export function mailRateKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set")
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      "",
      "portal-applications-mail-rate",
      32
    )
  )
}
