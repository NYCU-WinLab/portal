import { createHash, timingSafeEqual } from "node:crypto"

// The door panel (idm-display) reads with DISPLAY_API_SECRET, the same
// secret the portal sends its greetings with.

const noStore = { "cache-control": "no-store" }

/** A response when the caller is not the panel, else null. */
export function panelRefused(request: Request) {
  const secret = process.env.DISPLAY_API_SECRET
  if (!secret || secret.length < 32)
    return Response.json(
      { error: "not configured" },
      { status: 503, headers: noStore }
    )
  const token = /^Bearer ([!-~]{1,1024})$/i.exec(
    request.headers.get("authorization") ?? ""
  )?.[1]
  const digest = (value: string) => createHash("sha256").update(value).digest()
  if (!token || !timingSafeEqual(digest(token), digest(secret)))
    return Response.json(
      { error: "unauthorized" },
      { status: 401, headers: noStore }
    )
  return null
}

export const panelJson = (body: unknown) =>
  Response.json(body, { headers: noStore })
