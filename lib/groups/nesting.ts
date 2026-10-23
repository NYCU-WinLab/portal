// The gcp-* fence for nested groups. scope.ts keeps the portal off the gcp-*
// groups' own member lists, but a group that is a MEMBER of a gcp-* group
// changes who is effectively in it whenever its own members change. So
// before a write, walk the target's ancestors and refuse if any one is a
// group the portal may not touch.

import { isManageableGroup } from "@/lib/groups/scope"

/** Parent levels checked: the group's parents, theirs, and theirs. */
export const MAX_NESTING_DEPTH = 3

/** The ancestry is deeper than we look, so it can't be vouched for. */
export class NestingTooDeepError extends Error {
  constructor() {
    super("group nesting is deeper than the fence checks")
    this.name = "NestingTooDeepError"
  }
}

/**
 * The first ancestor of `groupEmail` that scope.ts refuses (gcp-* or outside
 * the domain), breadth-first, or null when the whole ancestry is clean.
 * `parentsOf` throws when the lookup fails and that is left to propagate:
 * the caller fails closed. Cycles end at the visited set.
 */
export async function findForbiddenAncestor(
  parentsOf: (groupEmail: string) => Promise<string[]>,
  groupEmail: string,
  domain: string,
  maxDepth = MAX_NESTING_DEPTH
): Promise<string | null> {
  const visited = new Set([groupEmail.trim().toLowerCase()])
  let level = [...visited]
  // Ancestors at distance 1..maxDepth are all checked. The extra pass asks
  // for the parents of the farthest level only to learn whether the ancestry
  // goes on: if it does, it is deeper than we look and can't be vouched for.
  for (let depth = 0; depth <= maxDepth; depth++) {
    const next: string[] = []
    for (const email of level) {
      for (const raw of await parentsOf(email)) {
        const parent = raw.trim().toLowerCase()
        if (visited.has(parent)) continue
        visited.add(parent)
        if (!isManageableGroup(parent, domain)) return parent
        next.push(parent)
      }
    }
    if (next.length === 0) return null
    if (depth === maxDepth) throw new NestingTooDeepError()
    level = next
  }
  return null
}
