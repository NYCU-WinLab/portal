// What the LED panel and speaker at the door (idm-display) say when a member
// comes in: the suffix after their name and a sound from their playlist.
// The panel reads them from /api/door/greetings with DISPLAY_API_SECRET and
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
/** Sounds one member can have in the pool, which keeps it in the
 * database's reach (3 MB each). */
export const SOUND_UPLOADS_MAX = 10
/** Sounds on one playlist. */
export const PLAYLIST_MAX = 20
export const SOUND_LABEL_MAX = 40
/** idm-display cuts every sound here and levels its loudness. */
export const SOUND_MAX_SECONDS = 30

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

const han = (char: string) => /\p{Script=Han}/u.test(char)

/** The label the panel shows for a name, by idm-display's display_name:
 * "詠翔 詹" -> "詹詠翔", Han names cut to 4 characters, a Latin name to its
 * first word in ASCII, at most 8. The panel looks suffixes up by it. */
export function panelName(name: string) {
  let collapsed = name.trim().replace(/\s+/g, " ")
  const parts = /^(\S+) (\S+)$/.exec(collapsed)
  if (parts && [...parts[1], ...parts[2]].every(han))
    collapsed = `${parts[2]}${parts[1]}`
  if ([...collapsed].some(han))
    return [...collapsed.replace(/\s/g, "")].slice(0, 4).join("")
  const first = collapsed.split(/[\s@]/)[0]
  const ascii = first
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x20-\x7e]/g, "")
  return ascii ? ascii.slice(0, 8) : [...first].slice(0, 4).join("")
}

const LINK_SECONDS = 60 * 60

const signature = (secret: string, soundId: string, expires: number) =>
  createHmac("sha256", secret)
    .update(`${soundId}.${expires}`)
    .digest("base64url")

/** An hour-long link to a pool sound; the panel fetches it without a
 * header, and re-reads greetings every few minutes. */
export function soundLink(soundId: string) {
  const secret = process.env.DISPLAY_API_SECRET!
  const expires = Math.floor(Date.now() / 1000) + LINK_SECONDS
  const query = new URLSearchParams({
    exp: String(expires),
    sig: signature(secret, soundId, expires),
  })
  return `${process.env.BETTER_AUTH_URL}/api/door/sounds/${soundId}?${query}`
}

export function soundLinkValid(soundId: string, expires: number, sig: string) {
  const secret = process.env.DISPLAY_API_SECRET
  if (!secret || !Number.isSafeInteger(expires)) return false
  if (expires < Date.now() / 1000) return false
  const expected = Buffer.from(signature(secret, soundId, expires))
  const given = Buffer.from(sig)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
