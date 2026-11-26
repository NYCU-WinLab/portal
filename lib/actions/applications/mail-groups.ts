import type { Email } from "@/lib/applications/domain/values"
import type { MailGroups } from "@/lib/applications/ports"
import { groupsApiFromEnv } from "@/lib/groups/google-auth"
import {
  addMember,
  getGroup,
  listParentGroups,
  type GroupsApi,
} from "@/lib/groups/google"
import {
  findForbiddenAncestor,
  NestingTooDeepError,
} from "@/lib/groups/nesting"
import { isManageableGroup } from "@/lib/groups/scope"
import { traced } from "@/lib/otel"

/** A failure as a log line: its type and Google status, never its text. */
const brief = (error: unknown) => ({
  type: error instanceof Error ? error.name : typeof error,
  status:
    typeof (error as { status?: unknown })?.status === "number"
      ? (error as { status: number }).status
      : undefined,
})

/**
 * The mail groups a new member is put in, through the Google Directory API
 * the /groups page already uses. The same rules apply: the actor must manage
 * the group (a portal admin always does), and the group as Google reports it
 * must be one the portal may touch (lib/groups/scope.ts) and not nested in
 * one it may not (lib/groups/nesting.ts).
 *
 *   ok / already  the address was added, or already was a member
 *   denied        the actor does not manage this group
 *   protected     the group is not one the portal may touch: gcp-*, outside
 *                 the domain, unknown to Google, or nested in such a group
 *   error         Google is not set up or failed; nothing is known to have
 *                 been written, or it is unknown
 *
 * Spans and logs carry the group id, never the address.
 */
export class GoogleMailGroups implements MailGroups {
  /** `apiFor` is one fresh client per call, so each has its own deadline. */
  constructor(
    private readonly apiFor: () => GroupsApi | null = groupsApiFromEnv
  ) {}

  async add(
    groupId: string,
    email: Email,
    as: { actorId: string | null; isManager(groupId: string): Promise<boolean> }
  ): Promise<"ok" | "already" | "protected" | "denied" | "error"> {
    return traced("mail group add", { group: groupId }, async () => {
      const api = this.apiFor()
      if (!api) return "error"
      try {
        // Manager first: a non-manager never causes a Google call.
        if (!(await as.isManager(groupId))) return "denied"
        const group = await getGroup(api, groupId)
        if (
          !group ||
          group.id !== groupId ||
          !isManageableGroup(group.email, api.domain)
        )
          return "protected"
        const ancestor = await findForbiddenAncestor(
          (address) => listParentGroups(api, address),
          group.email,
          api.domain
        ).catch((error: unknown) => {
          // Too deep to vouch for counts as nested in a protected group.
          if (error instanceof NestingTooDeepError) return "too deep"
          throw error
        })
        if (ancestor !== null) return "protected"
        return (await addMember(api, groupId, email.value)).outcome
      } catch (error) {
        console.error("[mail-groups] add failed", { groupId, ...brief(error) })
        return "error"
      }
    })
  }

  async isManageable(groupId: string): Promise<boolean> {
    const api = this.apiFor()
    if (!api) return false
    try {
      const group = await getGroup(api, groupId)
      return (
        !!group &&
        group.id === groupId &&
        isManageableGroup(group.email, api.domain)
      )
    } catch (error) {
      console.error("[mail-groups] lookup failed", { groupId, ...brief(error) })
      return false
    }
  }

  /** Group id to address; a group Google cannot give is left out. */
  async addresses(groupIds: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>()
    const api = this.apiFor()
    if (!api) return out
    const found = await Promise.all(
      groupIds.map(async (id) => {
        try {
          return await getGroup(api, id)
        } catch (error) {
          console.error("[mail-groups] lookup failed", {
            groupId: id,
            ...brief(error),
          })
          return null
        }
      })
    )
    groupIds.forEach((id, i) => {
      const group = found[i]
      if (group) out.set(id, group.email)
    })
    return out
  }
}
