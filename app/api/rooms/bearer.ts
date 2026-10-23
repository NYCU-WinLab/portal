import { createHash, timingSafeEqual } from "node:crypto"

/** The token in `Authorization: Bearer <token>`, or null. */
export const bearer = (header: string | null) =>
  /^Bearer ([!-~]{1,1024})$/i.exec(header?.trim() ?? "")?.[1] ?? null

/** Compares in constant time, whatever the lengths. */
export function sameSecret(presented: string, secret: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(presented), digest(secret))
}
