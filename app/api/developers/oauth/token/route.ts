import { createOAuthStore } from "@/lib/actions/developers"
import { preflight, tokenResponse } from "@/lib/developers/http"

// Authorization code exchange and refresh, for registered applications.
export async function POST(request: Request) {
  return tokenResponse(request, createOAuthStore())
}
export const OPTIONS = preflight
