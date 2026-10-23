// The CS department's meeting room system. Not an official API: read off
// its own pages' JavaScript. Rooms and reservations are public; booking and
// cancelling log in as the lab's shared account
// (MEETINGROOM_SERVICE_USER / MEETINGROOM_SERVICE_PASSWORD) once per call,
// since the session is a plain CodeIgniter cookie.
//   GET  reservation/room/get              -> rooms
//   GET  reservation/get/<room>/<date>     -> that day's reservations
//   POST login/auth                        -> ci_session cookie
//   POST reservation/add | reservation/delete

import type { Busy, Room } from "@/lib/rooms/availability"

const base = () =>
  (
    process.env.MEETINGROOM_URL ??
    "https://www.cs.nycu.edu.tw/csauto/meetingroom"
  ).replace(/\/$/, "")
const timeout = () => AbortSignal.timeout(10_000)

/** The account the lab books under; its reservations are the lab's own. */
export const labAccount = () =>
  process.env.MEETINGROOM_SERVICE_USER ?? "cctseng"

export const bookingConfigured = () =>
  Boolean(
    process.env.MEETINGROOM_SERVICE_USER &&
    process.env.MEETINGROOM_SERVICE_PASSWORD
  )

async function getJson<T>(path: string): Promise<T> {
  // It times out now and then on an otherwise healthy request: retry twice.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${base()}/${path}`, {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: timeout(),
      })
      if (!response.ok) throw new Error(`系上借用系統回應 ${response.status}`)
      return (await response.json()) as T
    } catch (error) {
      if (attempt >= 2) {
        if (error instanceof SyntaxError)
          throw new Error("系上借用系統沒有回傳資料，可能擋了這台主機")
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
}

export async function listRooms(): Promise<Room[]> {
  const rows = await getJson<
    { name: string; people: string; charge: string; inactive: string }[]
  >("reservation/room/get")
  return rows.map((row) => ({
    name: row.name,
    capacity: Number(row.people),
    charge: Number(row.charge),
    active: row.inactive === "0",
  }))
}

// A minute-old answer is fine for drawing the grid and spares a system
// that answers bursts with error pages now and then. Booking re-reads the
// day fresh (fresh: true) before it picks a room.
const cache = new Map<string, { at: number; busy: Promise<Busy[]> }>()
const CACHE_MS = 60_000

function busyIn(room: string, day: string, fresh: boolean): Promise<Busy[]> {
  const key = `${room}/${day}`
  const hit = cache.get(key)
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.busy
  const busy = getJson<
    { room: string; start: string; end: string; subscriber: string }[]
  >(`reservation/get/${encodeURIComponent(room)}/${day}`).then((rows) =>
    rows.map((row) => ({
      room: row.room,
      start: new Date(Number(row.start)).toISOString(),
      end: new Date(Number(row.end)).toISOString(),
      subscriber: row.subscriber,
    }))
  )
  cache.set(key, { at: Date.now(), busy })
  busy.catch(() => cache.delete(key))
  return busy
}

/** Reservations per day. There is no all-rooms endpoint, so this is rooms
 * x days requests, two days at a time to spare a system we don't own. */
export async function listBusy(rooms: string[], days: string[], fresh = false) {
  const byDay = new Map<string, Busy[]>()
  for (let i = 0; i < days.length; i += 2) {
    const batch = days.slice(i, i + 2)
    const found = await Promise.all(
      batch.map(async (day) =>
        (
          await Promise.all(rooms.map((room) => busyIn(room, day, fresh)))
        ).flat()
      )
    )
    batch.forEach((day, j) => byDay.set(day, found[j]))
  }
  return byDay
}

async function signIn() {
  const userId = process.env.MEETINGROOM_SERVICE_USER
  const password = process.env.MEETINGROOM_SERVICE_PASSWORD
  if (!userId || !password) throw new Error("系上借用帳號沒有設定")
  const response = await fetch(`${base()}/login/auth`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ user_id: userId, password }),
    redirect: "manual",
    signal: timeout(),
  })
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("ci_session="))
  if (!cookie) throw new Error("系上借用帳號登入失敗")
  return cookie
}

type Reservation = { room: string; start: string; end: string }

// The system's own client posts the whole reservation for add and delete
// alike. "free" is its "open for others to register" box, left unset.
async function post(path: string, body: Record<string, string>) {
  const response = await fetch(`${base()}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await signIn() },
    body: JSON.stringify({
      type: "short",
      subscriber: labAccount(),
      comment: "",
      free: "",
      ...body,
    }),
    signal: timeout(),
  })
  if (!response.ok) {
    // Its own page shows this body as the reason; keep it.
    const reason = (await response.text().catch(() => "")).trim().slice(0, 300)
    throw new Error(
      `系上借用系統拒絕了（${response.status}${reason ? `：${reason}` : ""}）`
    )
  }
  return response
}

/** Books a room; returns the system's reservation id. */
export async function reserve(reservation: Reservation) {
  const response = await post("reservation/add", reservation)
  const { id } = (await response.json()) as { id?: string | number }
  if (id === undefined || id === null || id === "")
    throw new Error("系上借用系統沒有回傳預約編號")
  return String(id)
}

export async function release(id: string, reservation: Reservation) {
  await post("reservation/delete", { id, ...reservation })
}
