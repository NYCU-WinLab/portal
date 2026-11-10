"use server"

import { runAction } from "@/lib/actions/define"
import { markReleaseNotesSeen } from "@/lib/actions/releases"
import { getSession } from "@/lib/auth/session"

/** Closes the release dialog until a newer note on a later day. */
export async function markSeen() {
  const session = await getSession()
  if (!session) return
  await runAction(
    markReleaseNotesSeen,
    { userId: session.user.id, via: "web" },
    {}
  )
}
