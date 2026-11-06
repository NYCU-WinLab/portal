// Google Calendar, read only: a member signs in with Google once (OAuth with
// PKCE, offline access) and the portal reads the calendars they pick with the
// refresh token it gets back: events where they may see them, busy blocks
// (free/busy) where they may not. The OAuth client lives in the WinLab Google
// Cloud project (GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET).
// Never touches the database; only lib/actions/calendar.ts calls it.

import { createHash, randomBytes } from "node:crypto"

const EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly"
/** Lists the account's calendars; without it only the primary one is read. */
export const LIST_SCOPE =
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly"
/** Reads busy blocks of calendars shared as free/busy only. */
export const FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.freebusy"
const SCOPES = ["openid", "email", EVENTS_SCOPE, LIST_SCOPE, FREEBUSY_SCOPE]
const timeout = () => AbortSignal.timeout(10_000)

/** Holds state, PKCE verifier and member id between /connect and /callback.
 * __Host-: no other *.winlab.tw site can plant one. */
export const CONSENT_COOKIE = "__Host-calendar_consent"

/** Failures the callback may name on /calendar; anything else shows as a
 * generic failure, so the address bar cannot put words on the page. */
export const LINK_FAILURES = {
  "not-configured": "行事曆沒有設定 Google 登入",
  state: "連結逾時或來源不符，請再試一次",
  denied: "Google 沒有授權",
  scope: "要勾選「查看行事曆活動」才能連結",
  failed: "連結失敗，請再試一次",
} as const

export const googleCalendarConfigured = () =>
  Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  )

export const redirectUri = () =>
  `${process.env.BETTER_AUTH_URL}/api/calendar/google/callback`

/** A fresh state and PKCE pair for one sign-in. */
export function newConsent() {
  const state = randomBytes(24).toString("base64url")
  const verifier = randomBytes(48).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { state, verifier, challenge }
}

/** Google's consent page. prompt=consent so Google always returns a
 * refresh token, also to a member who linked before. */
export function consentUrl(state: string, challenge: string) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString()
  return url.toString()
}

type TokenAnswer = {
  access_token: string
  refresh_token?: string
  id_token?: string
  scope?: string
}

async function token(body: Record<string, string>): Promise<TokenAnswer> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!,
      ...body,
    }),
    cache: "no-store",
    signal: timeout(),
  })
  if (response.status === 400 || response.status === 401) {
    const answer = (await response.json().catch(() => ({}))) as {
      error?: string
    }
    if (answer.error === "invalid_grant") throw new GrantRevoked()
  }
  if (!response.ok) throw new Error(`Google token ${response.status}`)
  return (await response.json()) as TokenAnswer
}

export class MissingScope extends Error {
  constructor() {
    super("要勾選「查看行事曆活動」才能連結")
  }
}

/** The member took back the portal's access in their Google account. */
export class GrantRevoked extends Error {
  constructor() {
    super("Google 授權已失效，請重新連結")
  }
}

/** Trades the code from the callback for tokens and the Google address. */
export async function exchangeCode(code: string, verifier: string) {
  const answer = await token({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri(),
  })
  if (!answer.refresh_token) throw new Error("Google 沒有給 refresh token")
  const scopes = answer.scope?.split(" ") ?? []
  if (!scopes.includes(EVENTS_SCOPE)) throw new MissingScope()
  // The id token came straight from Google's token endpoint over TLS, so its
  // claims are read without checking the signature (OpenID Connect 3.1.3.7).
  const claims = JSON.parse(
    Buffer.from(answer.id_token?.split(".")[1] ?? "", "base64url").toString() ||
      "{}"
  ) as { email?: string; email_verified?: boolean }
  if (!claims.email) throw new Error("Google 沒有給信箱")
  return {
    refreshToken: answer.refresh_token,
    accessToken: answer.access_token,
    email: claims.email,
    scopes: scopes.filter((scope) => scope.startsWith("https://")),
  }
}

export async function accessTokenFor(refreshToken: string) {
  const answer = await token({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  return answer.access_token
}

/** Tells Google to drop the grant; a grant already gone is fine. */
export async function revoke(refreshToken: string) {
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    signal: timeout(),
  }).catch(() => {})
}

export type GoogleEvent = {
  googleId: string
  startsAt: Date
  endsAt: Date
  allDay: boolean
  title: string
  location: string
  private: boolean
}

type RawEvent = {
  id: string
  status?: string
  summary?: string
  location?: string
  visibility?: string
  transparency?: string
  start?: { dateTime?: string; date?: string; timeZone?: string }
  end?: { dateTime?: string; date?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
}

// An all-day event's date is a Taipei day: 00:00 there.
const taipeiMidnight = (day: string) => new Date(`${day}T00:00:00+08:00`)

async function google(accessToken: string, url: URL, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    cache: "no-store",
    signal: timeout(),
  })
  if (response.status === 401) throw new GrantRevoked()
  if (response.status === 404) throw new CalendarGone()
  if (!response.ok) throw new Error(`Google Calendar ${response.status}`)
  return response.json() as Promise<unknown>
}

/** The calendar was deleted, or the member lost access to it. */
export class CalendarGone extends Error {
  constructor() {
    super("Google 找不到這個日曆，可能已刪除或不再分享給你")
  }
}

export type GoogleCalendar = {
  id: string
  summary: string
  /** owner, writer, reader or freeBusyReader. */
  accessRole: string
  primary: boolean
}

/** Every calendar in the account's list, hidden ones included. */
export async function calendarList(
  accessToken: string
): Promise<GoogleCalendar[]> {
  const calendars: GoogleCalendar[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 5; page++) {
    const url = new URL(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList"
    )
    url.search = new URLSearchParams({
      showHidden: "true",
      maxResults: "250",
      fields:
        "nextPageToken,items(id,summary,summaryOverride,accessRole,primary)",
      ...(pageToken ? { pageToken } : {}),
    }).toString()
    const body = (await google(accessToken, url)) as {
      items?: {
        id: string
        summary?: string
        summaryOverride?: string
        accessRole?: string
        primary?: boolean
      }[]
      nextPageToken?: string
    }
    for (const item of body.items ?? [])
      calendars.push({
        id: item.id,
        summary: (item.summaryOverride || item.summary || item.id).slice(
          0,
          200
        ),
        accessRole: item.accessRole ?? "freeBusyReader",
        primary: item.primary === true,
      })
    pageToken = body.nextPageToken
    if (!pageToken) break
  }
  return calendars
}

/**
 * The busy blocks of a calendar the member may only see as free/busy. They
 * carry no title, so they show as busy to everyone.
 */
export async function busyBlocks(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date
): Promise<GoogleEvent[]> {
  const body = (await google(
    accessToken,
    new URL("https://www.googleapis.com/calendar/v3/freeBusy"),
    {
      method: "POST",
      body: JSON.stringify({
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        items: [{ id: calendarId }],
      }),
    }
  )) as {
    calendars?: Record<
      string,
      { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }
    >
  }
  const calendar = body.calendars?.[calendarId]
  if (calendar?.errors?.some((error) => error.reason === "notFound"))
    throw new CalendarGone()
  if (calendar?.errors?.length)
    throw new Error(`Google free/busy ${calendar.errors[0].reason}`)
  return (calendar?.busy ?? []).map((block) => ({
    googleId: `busy:${block.start}`,
    startsAt: new Date(block.start),
    endsAt: new Date(block.end),
    allDay: false,
    title: "",
    location: "",
    private: true,
  }))
}

/**
 * The events on one of the member's calendars that make them busy between
 * from and to: recurring events expanded, cancelled ones, ones marked free
 * (transparent) and ones they declined left out.
 */
export async function busyEvents(
  accessToken: string,
  calendarId: string,
  from: Date,
  to: Date
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 10; page++) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
    )
    url.search = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
      fields:
        "nextPageToken,items(id,status,summary,location,visibility,transparency,start,end,attendees(self,responseStatus))",
      ...(pageToken ? { pageToken } : {}),
    }).toString()
    const body = (await google(accessToken, url)) as {
      items?: RawEvent[]
      nextPageToken?: string
    }
    for (const item of body.items ?? []) {
      if (item.status === "cancelled" || item.transparency === "transparent")
        continue
      const me = item.attendees?.find((attendee) => attendee.self)
      if (me?.responseStatus === "declined") continue
      const allDay = Boolean(item.start?.date)
      const startsAt = allDay
        ? taipeiMidnight(item.start!.date!)
        : new Date(item.start?.dateTime ?? "")
      const endsAt = allDay
        ? taipeiMidnight(item.end?.date ?? item.start!.date!)
        : new Date(item.end?.dateTime ?? "")
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
        continue
      events.push({
        googleId: item.id,
        startsAt,
        endsAt,
        allDay,
        title: (item.summary ?? "").slice(0, 300),
        location: (item.location ?? "").slice(0, 300),
        private:
          item.visibility === "private" || item.visibility === "confidential",
      })
    }
    pageToken = body.nextPageToken
    if (!pageToken) break
  }
  return events
}
