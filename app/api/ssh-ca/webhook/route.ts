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

// POST /api/ssh-ca/webhook: the lab CA's ENRICHING webhook (step-ca). While
// it signs a member's SSH certificate it sends the request the member made;
// the key ID is the member's email. The answer lists the services that email
// may log in to, as svc:<slug> principals, and to the CA alone also the
// member's Carrel projects as project:<name>, with the email and a sha256 of
// the Keycloak account id it found, so the CA can refuse when they are not
// the ones in the member's signed token. It answers nothing else.
export async function POST(request: Request) {
  if (limited(callerAddress(request)))
    return refuse(429, "too many requests", "webhook")
  const body = await readBody(request)
  if (body === undefined) return refuse(400, "body is not JSON", "webhook")
  const keyId = (body as { sshCertificateRequest?: { keyID?: unknown } })
    ?.sshCertificateRequest?.keyID
  const email = typeof keyId === "string" ? keyId.toLowerCase() : ""
  if (!EMAIL.test(email))
    return refuse(400, "key ID is not an email", "webhook")

  let result: Awaited<ReturnType<typeof readCertificatePrincipals>>
  try {
    result = await readCertificatePrincipals(email)
  } catch (error) {
    // Keycloak could not say who is a member: the CA signs nothing.
    emitErrorLog(error, { route: "ssh-ca-webhook" })
    return refuse(503, "member directory unavailable", "webhook")
  }
  if (!result.member)
    return Response.json({ allow: false }, { headers: noStore })
  return Response.json(
    {
      allow: true,
      data: {
        email,
        subject: result.subject,
        principals: [
          ...result.services.map((slug) => `svc:${slug}`),
          ...(fromCA(request)
            ? result.projects.map((name) => `project:${name}`)
            : []),
        ],
      },
    },
    { headers: noStore }
  )
}
