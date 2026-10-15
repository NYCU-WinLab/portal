import { createHash, timingSafeEqual } from "node:crypto"

import { cardSwipes, recordCardSwipes } from "@/lib/actions/door"

// hams-bridge reports card swipes here with its own secret. The secret only
// reaches this insert; it cannot open the door or change cards.

const MAX_BODY_BYTES = 64 * 1024

function authorized(header: string | null, secret: string) {
  const token = /^Bearer ([!-~]{1,1024})$/i.exec(header ?? "")?.[1]
  if (!token) return false
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(token), digest(secret))
}

export async function POST(request: Request) {
  const secret = process.env.HAMS_EVENTS_SECRET
  if (!secret || secret.length < 32)
    return Response.json({ error: "not configured" }, { status: 503 })
  if (!authorized(request.headers.get("authorization"), secret))
    return Response.json({ error: "unauthorized" }, { status: 401 })

  // Read up to the limit and stop, whatever Content-Length claims.
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = request.body?.getReader()
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return Response.json({ error: "body over 64 KiB" }, { status: 413 })
    }
    chunks.push(value)
  }
  let parsed
  try {
    parsed = cardSwipes.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8"))
    )
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }
  if (!parsed.success)
    return Response.json({ error: "invalid card events" }, { status: 400 })

  const accepted = await recordCardSwipes(parsed.data.events)
  return Response.json({ accepted })
}
