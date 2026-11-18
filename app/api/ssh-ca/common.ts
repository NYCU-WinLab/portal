import { recordRefusal } from "@/lib/otel"

// Shared by the lab CA's two webhooks under /api/ssh-ca. Anyone can call
// them (step-ca cannot sign its requests with a secret it loads from its
// config), so each caller address gets a few calls a minute. The CA's own
// addresses (SSH_CA_ADDRESSES, comma separated) are not limited: every
// member's signing comes from them.

const LIMIT = 20
const WINDOW_MS = 60_000
const MAX_ADDRESSES = 10_000
const calls = new Map<string, { count: number; until: number }>()
const caAddresses = new Set(
  (process.env.SSH_CA_ADDRESSES ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
)

/** The caller's address: the gateway appends the one it saw, so the last
 * entry is the one a client cannot set (issue 146). */
export const callerAddress = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown"

/** The lab CA itself: only it learns a member's project groups. */
export const fromCA = (request: Request) =>
  caAddresses.has(callerAddress(request))

export function limited(ip: string) {
  if (caAddresses.has(ip)) return false
  const now = Date.now()
  if (calls.size >= MAX_ADDRESSES && !calls.has(ip)) {
    for (const [key, entry] of calls) if (entry.until <= now) calls.delete(key)
    // Still full: this many addresses in a minute is an attack; new ones wait.
    if (calls.size >= MAX_ADDRESSES) return true
  }
  const entry = calls.get(ip)
  if (!entry || entry.until <= now) {
    calls.set(ip, { count: 1, until: now + WINDOW_MS })
    return false
  }
  entry.count += 1
  return entry.count > LIMIT
}

export const noStore = { "cache-control": "no-store" }
export const EMAIL = /^[^\s@]{1,64}@[a-z0-9.-]{1,190}$/

export function refuse(status: number, reason: string, route: string) {
  recordRefusal("ssh ca webhook refused", {
    "http.status": status,
    "refusal.reason": reason,
    "ssh_ca.route": route,
  })
  return Response.json({ error: reason }, { status, headers: noStore })
}

export async function readBody(request: Request) {
  try {
    return (await request.json()) as unknown
  } catch {
    return undefined
  }
}
