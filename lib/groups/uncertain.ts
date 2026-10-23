// Whether a write may have reached Google even though the call did not come
// back clean. The UI uses it to decide when to re-read the member list and
// whether to keep the addresses in the input for another try.

import type { GroupsResult, MembershipOutcome } from "@/lib/groups/types"

/**
 * A whole-request result that leaves open whether a write landed. The server
 * says so in `sent` (see GroupsResult); a failure that doesn't say is treated
 * as uncertain.
 */
export function mayHaveLanded(res: GroupsResult<unknown>): boolean {
  switch (res.status) {
    case "ok":
    case "unconfigured":
      return false
    case "forbidden":
      // The portal's own refusals come before any Google call; Google
      // refusing the service account can happen part-way through a batch.
      return res.reason === "google_permission" && res.sent !== false
    case "error":
      return res.sent !== false
  }
}

/** A per-address outcome that may have landed (a timeout says "result unknown"). */
export function outcomeUncertain(outcome: MembershipOutcome): boolean {
  return outcome === "error"
}
