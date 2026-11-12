// ICS calendars a member adds by address (Outlook, Apple, a course system,
// any calendar that publishes one) or as a file. Fetching an address the
// member typed must never reach the lab's own network: every connection
// checks the address it resolves to, so a name that points inside, or
// changes to point inside, is refused. Never touches the database; only
// lib/actions/calendar.ts calls it.

import { lookup as dnsLookup } from "node:dns"
import { request } from "node:https"
import { isIP, type LookupFunction } from "node:net"

import ICAL from "ical.js"

import type { GoogleEvent } from "@/lib/google-calendar"

/** A problem with the member's calendar they can act on; its message says
 * what, in their words. */
export class IcsError extends Error {}

/** Bigger calendars are refused; a member's calendar is far smaller. */
export const ICS_MAX_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3
/** The longest one address may take, redirects included, from the first
 * lookup to the last byte. */
const DEADLINE_MS = Number(process.env.ICS_DEADLINE_MS) || 20_000
const MAX_EVENTS = 5000
/** Occurrences one recurring event may step through, so an old daily rule
 * still reaches today but a FREQ=SECONDLY one stops. */
const MAX_STEPS = 20_000
/** Steps the whole file may take, so a file of many such rules cannot hold
 * the server (each step is CPU on the one event loop). */
const FILE_STEPS = 100_000
/** Steps all of one member's calendars may take in one sync: 20 files at
 * FILE_STEPS each would hold the event loop for about 10 s. */
export const MEMBER_STEPS = 300_000
/** VEVENTs a file may hold; a member's calendar is far smaller. */
const MAX_COMPONENTS = 20_000

/** A calendar address as members paste it: webcal:// is https. */
export function icsAddress(raw: string) {
  let url: URL
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, "https://"))
  } catch {
    throw new IcsError("行事曆網址不是網址")
  }
  if (url.protocol !== "https:") throw new IcsError("行事曆網址要是 https")
  if (url.username || url.password) throw new IcsError("行事曆網址不能帶帳密")
  return url.toString()
}

/** Whether an address is on the public internet. */
function publicAddress(address: string) {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  const v6 = address.toLowerCase()
  return !(
    v6 === "::" ||
    v6 === "::1" ||
    v6.startsWith("fc") ||
    v6.startsWith("fd") ||
    v6.startsWith("fe8") ||
    v6.startsWith("fe9") ||
    v6.startsWith("fea") ||
    v6.startsWith("feb") ||
    v6.startsWith("ff") ||
    v6.startsWith("64:ff9b:") ||
    v6.startsWith("::ffff:")
  )
}

/** Resolves like the system does, but only to public addresses. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 0)
    const found = (addresses as { address: string; family: number }[]).filter(
      (entry) => publicAddress(entry.address)
    )
    if (found.length === 0)
      return callback(new IcsError("行事曆網址指向內部網路"), "", 0)
    if (options.all) return callback(null, found as never, 0)
    callback(null, found[0].address, found[0].family)
  })
}

function get(
  url: URL,
  limitMs: number
): Promise<{ status: number; location?: string; body: string }> {
  return new Promise((resolve, reject) => {
    if (
      isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
      !publicAddress(url.hostname.replace(/^\[|\]$/g, ""))
    )
      return reject(new IcsError("行事曆網址指向內部網路"))
    const req = request(
      url,
      {
        lookup: publicLookup,
        headers: {
          accept: "text/calendar, */*;q=0.5",
          "user-agent": "WinLab-Portal-Calendar/1",
        },
        timeout: 10_000,
      },
      (response) => {
        const status = response.statusCode ?? 0
        if (status >= 300 && status < 400) {
          response.resume()
          return resolve({
            status,
            location: response.headers.location,
            body: "",
          })
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > ICS_MAX_BYTES) {
            req.destroy(new IcsError("行事曆超過 2 MB"))
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () =>
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") })
        )
        response.on("error", reject)
      }
    )
    // timeout above only catches an idle socket; this ends a response that
    // trickles in, so one slow address cannot hold up everyone's sync.
    const deadline = setTimeout(
      () =>
        req.destroy(
          new IcsError(`行事曆網址太慢，${DEADLINE_MS / 1000} 秒內沒有讀完`)
        ),
      limitMs
    )
    req.on("close", () => clearTimeout(deadline))
    req.on("timeout", () => req.destroy(new IcsError("行事曆網址沒有回應")))
    req.on("error", reject)
    req.end()
  })
}

/** Downloads a calendar from its address, following a few redirects. */
export async function fetchIcs(address: string) {
  let url = new URL(icsAddress(address))
  const until = Date.now() + DEADLINE_MS
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const left = until - Date.now()
    if (left <= 0)
      throw new IcsError(`行事曆網址太慢，${DEADLINE_MS / 1000} 秒內沒有讀完`)
    const answer = await get(url, left)
    if (answer.location) {
      url = new URL(icsAddress(new URL(answer.location, url).toString()))
      continue
    }
    if (answer.status === 404 || answer.status === 410)
      throw new IcsError("行事曆網址找不到，可能已失效")
    if (answer.status === 401 || answer.status === 403)
      throw new IcsError("行事曆網址拒絕讀取，可能已重設")
    if (answer.status < 200 || answer.status >= 300)
      throw new IcsError(`行事曆網址回應 ${answer.status}`)
    return answer.body
  }
  throw new IcsError("行事曆網址轉址太多次")
}

// A floating time, or one in a zone the file does not define, is a Taipei
// time: that is where the lab is.
function toDate(time: ICAL.Time) {
  if (time.isDate)
    return new Date(
      `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}T00:00:00+08:00`
    )
  const zone = time.zone
  if (zone && zone !== ICAL.Timezone.localTimezone) return time.toJSDate()
  const pad = (n: number) => String(n).padStart(2, "0")
  return new Date(
    `${String(time.year).padStart(4, "0")}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}+08:00`
  )
}

/**
 * The events of an ICS calendar that make its owner busy between from and
 * to: recurring events expanded with their exceptions, cancelled ones and
 * ones marked free (TRANSP:TRANSPARENT) left out. truncated says the file
 * was too big to read to the end, so busy times may be missing. left is
 * what remains of the member's MEMBER_STEPS, shared by their files.
 */
export function icsEvents(
  text: string,
  from: Date,
  to: Date,
  left: { steps: number } = { steps: FILE_STEPS }
): { events: GoogleEvent[]; truncated: boolean } {
  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(text))
  } catch {
    throw new IcsError("這不是 ICS 行事曆")
  }
  if (root.name !== "vcalendar") throw new IcsError("這不是 ICS 行事曆")
  // Times resolve their TZID from this file's own VTIMEZONEs (ical.js looks
  // them up in the component tree). Never register them in ical.js's shared
  // TimezoneService: one member's file would then change another's times.

  const events: GoogleEvent[] = []
  const add = (
    uid: string,
    event: ICAL.Event,
    start: ICAL.Time,
    end: ICAL.Time,
    key: string
  ) => {
    const status = String(event.component.getFirstPropertyValue("status") ?? "")
    const transp = String(event.component.getFirstPropertyValue("transp") ?? "")
    if (status.toUpperCase() === "CANCELLED") return
    if (transp.toUpperCase() === "TRANSPARENT") return
    const startsAt = toDate(start)
    let endsAt = toDate(end)
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
      return
    if (endsAt <= startsAt)
      endsAt = new Date(startsAt.getTime() + (start.isDate ? 86_400_000 : 0))
    if (endsAt <= from || startsAt >= to) return
    const level = String(
      event.component.getFirstPropertyValue("class") ?? ""
    ).toUpperCase()
    events.push({
      googleId: `${uid}:${key}`.slice(0, 500),
      startsAt,
      endsAt,
      allDay: start.isDate,
      title: (event.summary ?? "").slice(0, 300),
      location: (event.location ?? "").slice(0, 300),
      private: level === "PRIVATE" || level === "CONFIDENTIAL",
    })
  }

  const components = root.getAllSubcomponents("vevent")
  if (components.length > MAX_COMPONENTS)
    throw new IcsError(`行事曆超過 ${MAX_COMPONENTS} 個活動`)
  let budget = Math.min(FILE_STEPS, left.steps)
  const spent = budget
  let truncated = false
  for (const component of components) {
    if (budget <= 0 || events.length >= MAX_EVENTS) {
      truncated = true
      break
    }
    const event = new ICAL.Event(component)
    if (event.isRecurrenceException()) continue
    if (!event.startDate) continue
    const uid = event.uid || `${events.length}`
    if (!event.isRecurring()) {
      const end = event.endDate ?? event.startDate
      add(uid, event, event.startDate, end, event.startDate.toString())
      continue
    }
    const iterator = event.iterator()
    let ended = false
    for (let n = 0; n < MAX_STEPS && budget > 0; n++, budget--) {
      const next = iterator.next()
      if (!next || toDate(next) >= to) {
        ended = true
        break
      }
      // An occurrence starting over 60 days before the window cannot reach it.
      if (toDate(next).getTime() < from.getTime() - 60 * 86_400_000) continue
      const details = event.getOccurrenceDetails(next)
      add(
        uid,
        details.item,
        details.startDate,
        details.endDate,
        details.recurrenceId.toString()
      )
      if (events.length >= MAX_EVENTS) break
    }
    // Out of steps in the middle of this rule: its later times are unread.
    if (!ended && budget <= 0) truncated = true
  }
  left.steps -= spent - budget
  return { events, truncated }
}
