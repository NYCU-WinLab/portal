import { checkDoorToken } from "@/lib/actions/door-tokens"
import { errorMessage, runAction } from "@/lib/actions/define"
import { openDoor } from "@/lib/actions/door"

// POST /api/door/open with "Authorization: Bearer wdt_…" opens the lab door
// as the token's owner, the same action as the /door button. Only POST: a
// link someone follows (a GET) must never open the door. Members make tokens
// on /door/tokens.

const noStore = { "cache-control": "no-store" }

export async function POST(request: Request) {
  const token = /^Bearer (\S{1,256})$/i.exec(
    request.headers.get("authorization") ?? ""
  )?.[1]
  if (!token)
    return Response.json(
      { error: "missing bearer token" },
      { status: 401, headers: noStore }
    )
  const check = await checkDoorToken(token)
  if (!check.ok)
    return Response.json(
      { error: check.error },
      {
        status: check.status,
        headers:
          check.status === 429
            ? { ...noStore, "retry-after": String(check.retryAfter) }
            : noStore,
      }
    )
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined
  try {
    await runAction(
      openDoor,
      { userId: check.userId, via: "api", tokenId: check.tokenId, ip },
      {}
    )
  } catch (error) {
    return Response.json(
      { error: errorMessage(error) },
      { status: 502, headers: noStore }
    )
  }
  return Response.json({ opened: true }, { headers: noStore })
}
