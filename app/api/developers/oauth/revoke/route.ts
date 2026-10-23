import { createOAuthStore, revokeGrantById } from "@/lib/actions/developers"
import { preflight, revokeResponse } from "@/lib/developers/http"

// An application ends the consent its token belongs to.
export async function POST(request: Request) {
  return revokeResponse(request, createOAuthStore(), revokeGrantById)
}
export const OPTIONS = preflight
