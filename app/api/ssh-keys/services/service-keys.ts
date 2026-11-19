import { readServiceKeys } from "@/lib/actions/keys"
import { emitErrorLog } from "@/lib/otel"
import { certificateLines } from "@/lib/ssh-certificate-lines"

import { bearer, keysResponse, refuse } from "../respond"

/** A service's keys for the machine holding its read key: every member's,
 * or one member's when username is given. */
export async function serviceKeys(
  request: Request,
  service: string,
  username?: string
) {
  const token = bearer(request)
  if (!token) return refuse(401, "missing bearer key", service)
  let result: Awaited<ReturnType<typeof readServiceKeys>>
  try {
    result = await readServiceKeys(token, service, username)
  } catch (error) {
    // Keycloak could not say who is a member: the machine keeps the list
    // it read last instead of an empty one.
    emitErrorLog(error, { "ssh.service": service.slice(0, 32) })
    return refuse(503, "member directory unavailable", service)
  }
  if ("refused" in result)
    return refuse(
      result.refused,
      result.refused === 401
        ? "unknown read key"
        : "this key reads another service",
      service
    )
  const { members, certified } = result
  const keys = members.flatMap((member) => member.keys)
  return keysResponse(
    request,
    username ? keys : [...certificateLines(certified), ...keys],
    username
      ? (members[0] ?? { username: username.toLowerCase(), keys: [] })
      : members
  )
}
