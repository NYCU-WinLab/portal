import { readCertificatePrincipals } from "@/lib/actions/keys"
import { emitErrorLog, recordRefusal } from "@/lib/otel"

// POST /api/ssh-ca/webhook: the lab CA's ENRICHING webhook (step-ca). While
// it signs a member's SSH certificate it sends the request the member made;
// the key ID is the member's email. The answer lists the services that email
// may log in to, as svc:<slug> principals, with the email and a sha256 of
// the Keycloak account id it found, so the CA can refuse when they are not
// the ones in the member's signed token.
//
// Anyone can call this (step-ca cannot sign its requests with a secret it
// loads from its config), so it answers nothing but those, and each caller
// address gets a few calls a minute. The CA's own addresses
// (SSH_CA_ADDRESSES, comma separated) are not limited: every member's
// signing comes from them.

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

function limited(ip: string) {
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

const noStore = { "cache-control": "no-store" }
const EMAIL = /^[^\s@]{1,64}@[a-z0-9.-]{1,190}$/

function refuse(status: number, reason: string) {
  recordRefusal("ssh ca webhook refused", {
    "http.status": status,
    "refusal.reason": reason,
  })
  return Response.json({ error: reason }, { status, headers: noStore })
}

export async function POST(request: Request) {
  // The gateway appends the address it saw, so the last entry is the one a
  // client cannot set (issue 146).
  const ip =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
    "unknown"
  if (limited(ip)) return refuse(429, "too many requests")

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return refuse(400, "body is not JSON")
  }
  const keyId = (body as { sshCertificateRequest?: { keyID?: unknown } })
    ?.sshCertificateRequest?.keyID
  const email = typeof keyId === "string" ? keyId.toLowerCase() : ""
  if (!EMAIL.test(email)) return refuse(400, "key ID is not an email")

  let result: Awaited<ReturnType<typeof readCertificatePrincipals>>
  try {
    result = await readCertificatePrincipals(email)
  } catch (error) {
    // Keycloak could not say who is a member: the CA signs nothing.
    emitErrorLog(error, { route: "ssh-ca-webhook" })
    return refuse(503, "member directory unavailable")
  }
  if (!result.member)
    return Response.json({ allow: false }, { headers: noStore })
  return Response.json(
    {
      allow: true,
      data: {
        email,
        subject: result.subject,
        principals: result.services.map((slug) => `svc:${slug}`),
      },
    },
    { headers: noStore }
  )
}
