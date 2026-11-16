import { errorMessage, runAction } from "@/lib/actions/define"
import { listMemberSshKeys } from "@/lib/actions/keys"
import { apiError, authenticate } from "@/lib/api-key-http"

import { keysResponse } from "../../respond"

// GET /api/ssh-keys/members/<username>: every public key one member keeps
// on the portal, for a member's API key allowed into the keys app. Text
// goes straight into an authorized_keys file.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  const holder = await authenticate(request)
  if (holder instanceof Response) return holder
  if (!holder.apps.has("keys"))
    return apiError(403, "this key is not allowed into keys (SSH 金鑰)")
  try {
    const member = await runAction(
      listMemberSshKeys,
      { userId: holder.userId, via: "api", tokenId: holder.keyId },
      { username: (await params).username }
    )
    return keysResponse(request, member.keys, member)
  } catch (error) {
    return apiError(404, errorMessage(error))
  }
}
