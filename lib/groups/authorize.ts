// lib/groups/authorize.ts
// Two halves must hold before /groups reads or writes a group's members:
// the member manages this group (portal data, via is_group_manager，always
// true for a portal admin), and the group as Google reports it is one the
// portal may touch (scope.ts: in the domain, not gcp-*). The manager check
// comes first so a non-manager never causes a Google call. A manager row
// outliving its group in Google is a real state and reads as "not managed",
// not as an error.

import { isManageableGroup } from "@/lib/groups/scope"
import type { ManagedGroup } from "@/lib/groups/types"

export function authorizeGroup(input: {
  isManager: boolean
  group: ManagedGroup | null
  domain: string
}):
  | { ok: true; group: ManagedGroup }
  | { ok: false; reason: "denied" | "not_managed" } {
  if (!input.isManager) return { ok: false, reason: "denied" }
  if (!input.group || !isManageableGroup(input.group.email, input.domain))
    return { ok: false, reason: "not_managed" }
  return { ok: true, group: input.group }
}

/** The /groups list: every manageable group for a portal admin, else the assigned ones. */
export function visibleGroups(
  all: ManagedGroup[],
  input: { isAdmin: boolean; managed: ReadonlySet<string>; domain: string }
): ManagedGroup[] {
  return all.filter(
    (g) =>
      isManageableGroup(g.email, input.domain) &&
      (input.isAdmin || input.managed.has(g.id))
  )
}
