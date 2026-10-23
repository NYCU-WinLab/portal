import { applyMeetingCallback } from "@/lib/actions/rooms-meetings"

import { bearer } from "../bearer"

// The GitLab pipeline reports the Teams meeting it created or cancelled,
// with the one-time token it was handed for this request.

export async function POST(request: Request) {
  const token = bearer(request.headers.get("authorization"))
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 })
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 })
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    return Response.json({ error: "body must be an object" }, { status: 400 })
  const result = await applyMeetingCallback(
    token,
    body,
    request.headers.get("x-request-id")
  )
  return Response.json(result.body, { status: result.status })
}
