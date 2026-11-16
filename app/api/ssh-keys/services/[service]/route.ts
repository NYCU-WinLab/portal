import { serviceKeys } from "../service-keys"

// GET /api/ssh-keys/services/<slug>: every member allowed in the service,
// with the keys they put in it. For a machine with the service's read key.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ service: string }> }
) {
  return serviceKeys(request, (await params).service)
}
