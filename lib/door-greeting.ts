// What the LED panel and speaker at the door (idm-display) say when a member
// comes in: the suffix after their name and their own short sound. The
// panel reads them from /api/door/greetings with DISPLAY_API_SECRET and
// downloads each sound from a link signed with the same secret.
import { createHmac, timingSafeEqual } from "node:crypto"

/** The panel is 64 px wide after "歡迎 name": a CJK glyph is 10, ASCII 5. */
const SUFFIX_MAX_WIDTH = 32
const DISALLOWED = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}]/u

export const suffixWidth = (text: string) =>
  [...text].reduce((width, char) => {
    const code = char.codePointAt(0) ?? 0
    return width + (code >= 0x20 && code <= 0x7e ? 5 : 10)
  }, 0)

/** Why the panel cannot show suffix, or null when it can. */
export function suffixProblem(suffix: string) {
  if (DISALLOWED.test(suffix)) return "含有看板無法顯示的字元"
  if (suffixWidth(suffix) > SUFFIX_MAX_WIDTH)
    return "太長了，最多 3 個中文字或 6 個英數字"
  return null
}

export const SOUND_MAX_BYTES = 3 * 1024 * 1024

/** The audio type the file's own bytes say, or null for anything else. */
export function soundType(bytes: Uint8Array): string | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to))
  if (ascii(0, 3) === "ID3") return "audio/mpeg"
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav"
  if (ascii(0, 4) === "OggS") return "audio/ogg"
  if (ascii(4, 8) === "ftyp") return "audio/mp4"
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return "audio/aac"
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return "audio/mpeg"
  return null
}

/** "詠翔 詹" (given family, as Keycloak spells some names) -> "詹詠翔":
 * the panel looks members up by the name the card reader shows. */
export function panelName(name: string) {
  const collapsed = name.trim().replace(/\s+/g, " ")
  const swapped = /^(\p{Script=Han}+) (\p{Script=Han}+)$/u.exec(collapsed)
  return swapped ? `${swapped[2]}${swapped[1]}` : collapsed
}

const LINK_SECONDS = 60 * 60

const signature = (
  secret: string,
  userId: string,
  version: string,
  expires: number
) =>
  createHmac("sha256", secret)
    .update(`${userId}.${version}.${expires}`)
    .digest("base64url")

/** An hour-long link to a member's sound; the panel fetches it without a
 * header, and re-reads greetings every few minutes. */
export function soundLink(userId: string, version: string) {
  const secret = process.env.DISPLAY_API_SECRET!
  const expires = Math.floor(Date.now() / 1000) + LINK_SECONDS
  const query = new URLSearchParams({
    v: version,
    exp: String(expires),
    sig: signature(secret, userId, version, expires),
  })
  return `${process.env.BETTER_AUTH_URL}/api/door/sounds/${userId}?${query}`
}

export function soundLinkValid(
  userId: string,
  version: string,
  expires: number,
  sig: string
) {
  const secret = process.env.DISPLAY_API_SECRET
  if (!secret || !Number.isSafeInteger(expires)) return false
  if (expires < Date.now() / 1000) return false
  const expected = Buffer.from(signature(secret, userId, version, expires))
  const given = Buffer.from(sig)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
