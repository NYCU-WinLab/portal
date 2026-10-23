// Which Google groups /groups may touch. The service account's admin role
// reaches every group in the domain, so this file，not Google，is what
// keeps the portal off the gcp-* groups. The server checks it against the
// address Google returns for the group, before every read of members and
// every write; never against anything the caller sent.

import type { ManagedGroup } from "@/lib/groups/types"

const GROUP_ID = /^[A-Za-z0-9]{1,64}$/

/** A Directory group id, as /groups/[id] and group_managers carry it. */
export function isValidGroupId(id: string): boolean {
  return GROUP_ID.test(id)
}

/**
 * In the portal's domain, and not a gcp-* group. The gcp-* groups once held
 * GCP organisation roles; those grants now go to users directly, but the
 * groups stay off-limits so that never quietly becomes a way back in.
 *
 * This fences off the gcp-* groups' own member lists only; groups nested
 * inside one are caught by nesting.ts, which applies this same rule to every
 * ancestor before a write.
 */
export function isManageableGroup(email: string, domain: string): boolean {
  const address = email.trim().toLowerCase()
  const at = address.lastIndexOf("@")
  if (at <= 0) return false
  const local = address.slice(0, at)
  const host = address.slice(at + 1)
  if (host !== domain.trim().toLowerCase()) return false
  return !local.startsWith("gcp-")
}

export function filterGroups(
  groups: ManagedGroup[],
  query: string
): ManagedGroup[] {
  const q = query.trim().toLowerCase()
  if (!q) return groups
  return groups.filter(
    (g) => g.name.toLowerCase().includes(q) || g.email.includes(q)
  )
}
