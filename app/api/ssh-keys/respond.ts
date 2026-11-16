import { createHash } from "node:crypto"

import { recordRefusal } from "@/lib/otel"

// How /api/ssh-keys answers: JSON, or authorized_keys text for
// ?format=text or Accept: text/plain, with an ETag so a machine that polls
// gets 304 while nothing changed.

const headers = { "cache-control": "private, no-cache" }

export const bearer = (request: Request) =>
  /^Bearer (\S{1,256})$/i.exec(request.headers.get("authorization") ?? "")?.[1]

export function refuse(status: number, error: string, service?: string) {
  recordRefusal("ssh keys refused", {
    "http.status": status,
    "ssh.service": service?.slice(0, 32),
  })
  return Response.json(
    { error },
    { status, headers: { "cache-control": "no-store" } }
  )
}

export function wantsText(request: Request) {
  const format = new URL(request.url).searchParams.get("format")
  if (format) return format === "text"
  return (request.headers.get("accept") ?? "").includes("text/plain")
}

/** The key lines as text, or the given value as JSON. */
export function keysResponse(request: Request, lines: string[], json: unknown) {
  const text = wantsText(request)
  const body = text
    ? lines.map((line) => `${line}\n`).join("")
    : JSON.stringify(json)
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 27)}"`
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { ...headers, etag } })
  return new Response(body, {
    headers: {
      ...headers,
      etag,
      "content-type": text
        ? "text/plain; charset=utf-8"
        : "application/json; charset=utf-8",
    },
  })
}
