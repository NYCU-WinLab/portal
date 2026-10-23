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
/** Sounds one member can have in the pool. Real sounds average about
 * 300 KB (25 in the pool came to 7.6 MB on 2026-10-23), so 50 stays well
 * inside Postgres even at the 3 MB worst case. */
export const SOUND_UPLOADS_MAX = 50
/** Sounds on one playlist: as many as a member can upload. */
export const PLAYLIST_MAX = SOUND_UPLOADS_MAX
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

// A voice clip's link signs "voice.<id>" so it never doubles as a sound's.
const signature = (secret: string, soundId: string, expires: number) =>
  createHmac("sha256", secret)
    .update(`${soundId}.${expires}`)
    .digest("base64url")

function signedLink(path: string, key: string) {
  const secret = process.env.DISPLAY_API_SECRET!
  const expires = Math.floor(Date.now() / 1000) + LINK_SECONDS
  const query = new URLSearchParams({
    exp: String(expires),
    sig: signature(secret, key, expires),
  })
  return `${process.env.BETTER_AUTH_URL}${path}?${query}`
}

function linkValid(key: string, expires: number, sig: string) {
  const secret = process.env.DISPLAY_API_SECRET
  if (!secret || !Number.isSafeInteger(expires)) return false
  if (expires < Date.now() / 1000) return false
  const expected = Buffer.from(signature(secret, key, expires))
  const given = Buffer.from(sig)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** An hour-long link to a pool sound; the panel fetches it without a
 * header, and re-reads greetings every few minutes. */
export const soundLink = (soundId: string) =>
  signedLink(`/api/door/sounds/${soundId}`, soundId)

export const soundLinkValid = (soundId: string, expires: number, sig: string) =>
  linkValid(soundId, expires, sig)

/** The same for a voice clip. */
export const voiceLink = (clipId: string) =>
  signedLink(`/api/door/voice/${clipId}`, `voice.${clipId}`)

export const voiceLinkValid = (clipId: string, expires: number, sig: string) =>
  linkValid(`voice.${clipId}`, expires, sig)

// The spoken greeting, the same way idm-display builds it.

const COMPOUND_SURNAMES = [
  "歐陽",
  "司馬",
  "上官",
  "諸葛",
  "東方",
  "皇甫",
  "尉遲",
  "公孫",
  "慕容",
  "長孫",
  "令狐",
  "夏侯",
  "軒轅",
  "端木",
  "宇文",
  "張簡",
  "范姜",
]

/** A panel label without its (compound) Han surname; idm-display given_name. */
export function givenName(label: string) {
  const chars = [...label]
  if (chars.length < 2 || !chars.every(han)) return label
  const compound =
    COMPOUND_SURNAMES.includes(chars.slice(0, 2).join("")) && chars.length > 2
  return chars.slice(compound ? 2 : 1).join("")
}

/** What the door says for a member: given name, then the letters and Han
 * characters of their suffix ("水哥"; "＝)" says nothing). */
export const spokenName = (label: string, suffix: string | null) =>
  givenName(label) +
  [...(suffix ?? "")]
    .filter((c) => /[\p{Script=Han}\p{L}\p{N}]/u.test(c))
    .join("")

/** The spoken parts of before + name + after, each one voice clip: the name
 * ends with "，" when more follows and "。" when it is last; after drops the
 * punctuation it starts with. With no rule, before is "Hi，". */
export function voiceParts(name: string, before: string, after: string) {
  const head = before.trim()
  const tail = after.trim().replace(/^[\s，。、,.!！?？；;：:]+/u, "")
  return [head, name + (tail ? "，" : "。"), tail].filter(Boolean)
}

export const DEFAULT_BEFORE = "Hi，"

/** "HH:MM" for minutes after midnight. */
export const clock = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

/** The minutes of the week a rule covers, as [start, end) ranges on a
 * 0..10080 line (Monday 00:00 is 0), split where they wrap past Sunday. */
export function weekRanges(rule: {
  startsAt: number
  endsAt: number
  days: number
}) {
  const week = 7 * 1440
  const length = (rule.endsAt - rule.startsAt + 1440) % 1440
  const ranges: [number, number][] = []
  for (let day = 0; day < 7; day++) {
    if (!(rule.days & (1 << day))) continue
    const start = day * 1440 + rule.startsAt
    const end = start + length
    if (end <= week) ranges.push([start, end])
    else ranges.push([start, week], [0, end - week])
  }
  return ranges
}

export function rulesOverlap(
  a: Parameters<typeof weekRanges>[0],
  b: Parameters<typeof weekRanges>[0]
) {
  return weekRanges(a).some(([s1, e1]) =>
    weekRanges(b).some(([s2, e2]) => s1 < e2 && s2 < e1)
  )
}

/** Minutes since Monday 00:00 in Asia/Taipei, the line weekRanges uses. */
export function taipeiWeekMinute(now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value])
  )
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(
    parts.weekday
  )
  return day * 1440 + Number(parts.hour) * 60 + Number(parts.minute)
}
