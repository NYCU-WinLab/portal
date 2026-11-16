import { serviceKeys } from "../../service-keys"

// GET /api/ssh-keys/services/<slug>/<username>: one member's keys in the
// service, for sshd's AuthorizedKeysCommand. Nothing for a member who is
// not allowed in, the same as for one who has no keys.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ service: string; username: string }> }
) {
  const { service, username } = await params
  return serviceKeys(request, service, username)
}
