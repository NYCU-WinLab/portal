import { readServiceKeys } from "@/lib/actions/keys"
import { emitErrorLog } from "@/lib/otel"

import { bearer, keysResponse, refuse } from "../respond"

/** The lab CA's user key (ca.winlab.tw/ssh/roots, userKey). */
const LAB_USER_CA =
  "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEypPi2eUS00sJeJA9ebfrquCmA8reWrgdWSL4yGkfm4bKEuRyPmVJoM72JdUwzhH/v3VWkAkfPQ6sxMtzgruck="

/** One authorized_keys line that admits a lab certificate naming this
 * service (svc:<slug>). The CA puts that principal only in the certificates
 * of members this service lets in, by the same rule as the keys below, so a
 * shared account (B09's p4user) takes certificates with no change on the
 * machine. Not on the one-member list: that serves a member's own account,
 * which every member of the service must not reach. */
const certificateLine = (service: string) =>
  `cert-authority,principals="svc:${service}" ${LAB_USER_CA} lab-ssh-ca`

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
  const { members } = result
  const keys = members.flatMap((member) => member.keys)
  return keysResponse(
    request,
    username ? keys : [certificateLine(service), ...keys],
    username
      ? (members[0] ?? { username: username.toLowerCase(), keys: [] })
      : members
  )
}
