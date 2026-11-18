import { readCertificatePrincipals } from "@/lib/actions/keys"
import { emitErrorLog } from "@/lib/otel"

import {
  callerAddress,
  EMAIL,
  fromCA,
  limited,
  noStore,
  readBody,
  refuse,
} from "../common"

// POST /api/ssh-ca/authorize: the lab CA's AUTHORIZING webhook (step-ca).
// It runs on the finished certificate, after step-ca applied the member's
// requested validity, which the template cannot limit. The CA signs only on
// {allow: true}, so this is the last word on:
// - when the certificate starts: no later than a few minutes from now, so a
//   member cannot sign certificates for the months after they leave;
// - how long it lasts: at most the provisioner's 24 hours;
// - what it names: a user certificate whose principals are the member's
//   username and services, as the enriching webhook answered.

const MAX_LIFETIME_S = 24 * 3600 + 60
const SKEW_S = 300
/** Unix account names a member's username must never become a principal for. */
const RESERVED = new Set([
  "root",
  "admin",
  "administrator",
  "ubuntu",
  "debian",
  "user",
  "p4user",
  "git",
  "nobody",
  "daemon",
  "bin",
  "sys",
  "www-data",
  "postgres",
  "docker",
  "sshd",
  "operator",
  "provisioner",
])

type Certificate = {
  type?: unknown
  keyId?: unknown
  principals?: unknown
  validAfter?: unknown
  validBefore?: unknown
}

const deny = () => Response.json({ allow: false }, { headers: noStore })

export async function POST(request: Request) {
  if (limited(callerAddress(request)))
    return refuse(429, "too many requests", "authorize")
  const body = await readBody(request)
  if (body === undefined) return refuse(400, "body is not JSON", "authorize")
  const cert = (body as { sshCertificate?: Certificate })?.sshCertificate
  if (!cert) return refuse(400, "no SSH certificate", "authorize")

  const now = Math.floor(Date.now() / 1000)
  const { validAfter, validBefore, principals } = cert
  if (
    cert.type !== "user" ||
    typeof validAfter !== "number" ||
    typeof validBefore !== "number" ||
    validAfter > now + SKEW_S ||
    validBefore <= now ||
    validBefore - validAfter > MAX_LIFETIME_S ||
    !Array.isArray(principals) ||
    principals.length === 0 ||
    !principals.every((p) => typeof p === "string")
  )
    return deny()

  const email = typeof cert.keyId === "string" ? cert.keyId.toLowerCase() : ""
  if (!EMAIL.test(email)) return deny()
  let result: Awaited<ReturnType<typeof readCertificatePrincipals>>
  try {
    result = await readCertificatePrincipals(email)
  } catch (error) {
    emitErrorLog(error, { route: "ssh-ca-authorize" })
    return refuse(503, "member directory unavailable", "authorize")
  }
  if (!result.member || RESERVED.has(result.username)) return deny()
  // Project principals only for the CA: anyone else could ask this route
  // whether an email is in a project.
  const allowed = new Set([
    result.username,
    ...result.services.map((slug) => `svc:${slug}`),
    ...(fromCA(request)
      ? result.projects.map((name) => `project:${name}`)
      : []),
  ])
  if (!principals.every((p) => allowed.has(p))) return deny()
  return Response.json({ allow: true }, { headers: noStore })
}
