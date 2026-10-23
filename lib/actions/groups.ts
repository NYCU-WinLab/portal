import { and, count, desc, eq, gte, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { defineAction, type Actor } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { groupManagers, groupMembershipAudit, user } from "@/lib/db/schema"
import { type AuditInsert, splitDenied } from "@/lib/groups/audit"
import { visibleGroups } from "@/lib/groups/authorize"
import { fetchCohorts } from "@/lib/groups/cohorts"
import { failure } from "@/lib/groups/failure"
import { getGroup, listDomainGroups } from "@/lib/groups/google"
import { groupsApiFromEnv } from "@/lib/groups/google-auth"
import {
  addToGroup,
  type MembershipDeps,
  parseGroupId,
  readGroup,
  removeFromGroup,
} from "@/lib/groups/membership"
import { isManageableGroup } from "@/lib/groups/scope"
import { labDirectory } from "@/lib/keycloak"

// Google mailing lists (/groups). The member list lives only in Google;
// the portal reads it live and changes MEMBER rows only, never a gcp-*
// group, a group outside the domain or one nested in such a group (the
// checks are in lib/groups/membership.ts). Portal admins manage every list,
// others the ones they are assigned.

async function manages(actor: Actor, groupId: string) {
  if (await isAdmin(actor, "portal")) return true
  const [row] = await db
    .select({ groupId: groupManagers.groupId })
    .from(groupManagers)
    .where(
      and(
        eq(groupManagers.groupId, groupId),
        eq(groupManagers.userId, actor.userId)
      )
    )
  return Boolean(row)
}

/** Records every change tried, refused ones capped per actor and hour. */
async function audit(rows: AuditInsert[]) {
  if (!rows.length) return
  try {
    let keep = rows
    if (rows.some((row) => row.outcome === "denied")) {
      const [recent] = await db
        .select({ n: count() })
        .from(groupMembershipAudit)
        .where(
          and(
            eq(groupMembershipAudit.actorId, rows[0].actor_id),
            eq(groupMembershipAudit.outcome, "denied"),
            gte(groupMembershipAudit.createdAt, sql`now() - interval '1 hour'`)
          )
        )
      keep = splitDenied(rows, recent.n).keep
    }
    if (keep.length)
      await db.insert(groupMembershipAudit).values(
        keep.map((row) => ({
          actorId: row.actor_id,
          groupId: row.group_id,
          groupEmail: row.group_email,
          memberEmail: row.member_email,
          action: row.action,
          outcome: row.outcome,
          detail: row.detail,
        }))
      )
  } catch (error) {
    console.error("[groups] audit insert failed", error, rows)
  }
}

function deps(actor: Actor): MembershipDeps | null {
  const api = groupsApiFromEnv()
  if (!api) return null
  return {
    userId: actor.userId,
    api,
    isManager: (groupId) => manages(actor, groupId),
    audit: (rows) => void audit(rows),
  }
}

const unconfigured = { status: "unconfigured" } as const

export const listMailGroups = defineAction({
  name: "list_mail_groups",
  title: "群組信",
  description:
    "The Google mailing lists the member may manage (/groups): every list in the domain for a portal admin, otherwise the ones assigned to them; each with its Directory id, address and name. status unconfigured when the portal has no Google credential.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const api = groupsApiFromEnv()
    if (!api) return unconfigured
    const admin = await isAdmin(actor, "portal")
    const managed = new Set(
      (
        await db
          .select({ groupId: groupManagers.groupId })
          .from(groupManagers)
          .where(eq(groupManagers.userId, actor.userId))
      ).map((row) => row.groupId)
    )
    if (!admin && !managed.size) return { status: "ok" as const, data: [] }
    try {
      const all = await listDomainGroups(api)
      return {
        status: "ok" as const,
        data: visibleGroups(all, {
          isAdmin: admin,
          managed,
          domain: api.domain,
        }).sort((a, b) => a.email.localeCompare(b.email)),
      }
    } catch (error) {
      // Google's own wording stays in the server log.
      console.error("[groups] list failed", error)
      const result = failure(error, false)
      throw new Error("detail" in result ? result.detail : "讀不到 Google 群組")
    }
  },
})

const groupId = z.string().trim().min(1).max(64)

export const getMailGroup = defineAction({
  name: "get_mail_group",
  title: "群組信成員",
  description:
    "One mailing list the member manages and its members as Google reports them (address, role OWNER/MANAGER/MEMBER, type USER/GROUP/CUSTOMER). Google's list is eventually consistent: a change may take a few seconds to show.",
  kind: "query",
  input: z.object({ groupId }),
  run: async (actor, input) => {
    const d = deps(actor)
    return d ? readGroup(d, input.groupId) : unconfigured
  },
})

export const addMailGroupMembers = defineAction({
  name: "add_mail_group_members",
  title: "加入群組信",
  description:
    "Adds addresses (outside ones too) to a mailing list the member manages, as plain MEMBERs, at most 100 at once. Each address gets its own outcome: ok, already, denied, protected (not a member role) or error. Refused for gcp-* lists, lists outside the domain or nested in one.",
  kind: "mutation",
  input: z.object({
    groupId,
    emails: z.array(z.string().trim().min(3).max(254)).min(1).max(100),
  }),
  run: async (actor, input) => {
    const d = deps(actor)
    return d ? addToGroup(d, input.groupId, input.emails) : unconfigured
  },
})

export const removeMailGroupMember = defineAction({
  name: "remove_mail_group_member",
  title: "移出群組信",
  description:
    "Removes one MEMBER address from a mailing list the member manages; owners and managers are never removed here. Same list rules as add_mail_group_members.",
  kind: "mutation",
  input: z.object({ groupId, email: z.string().trim().min(3).max(254) }),
  run: async (actor, input) => {
    const d = deps(actor)
    return d ? removeFromGroup(d, input.groupId, input.email) : unconfigured
  },
})

export const listMailGroupChanges = defineAction({
  name: "list_mail_group_changes",
  title: "群組信變更",
  description:
    "The latest 50 membership changes tried on a mailing list the member manages, newest first: who, which address, add or remove, and the outcome (refused tries included).",
  kind: "query",
  input: z.object({ groupId }),
  run: async (actor, input) => {
    if (!(await manages(actor, input.groupId)))
      throw new Error("你不是這個群組的管理者")
    return {
      changes: await db
        .select({
          at: groupMembershipAudit.createdAt,
          actor: user.name,
          email: groupMembershipAudit.memberEmail,
          action: groupMembershipAudit.action,
          outcome: groupMembershipAudit.outcome,
          detail: groupMembershipAudit.detail,
        })
        .from(groupMembershipAudit)
        .leftJoin(user, eq(user.id, groupMembershipAudit.actorId))
        .where(eq(groupMembershipAudit.groupId, input.groupId))
        .orderBy(desc(groupMembershipAudit.createdAt))
        .limit(50),
    }
  },
})

export const listMailGroupManagers = defineAction({
  name: "list_mail_group_managers",
  title: "群組信管理者",
  description:
    "Who besides portal admins manages one mailing list: member id and name. Visible to the list's managers.",
  kind: "query",
  input: z.object({ groupId }),
  run: async (actor, input) => {
    if (!(await manages(actor, input.groupId)))
      throw new Error("你不是這個群組的管理者")
    return {
      managers: await db
        .select({ userId: user.id, name: user.name })
        .from(groupManagers)
        .innerJoin(user, eq(user.id, groupManagers.userId))
        .where(eq(groupManagers.groupId, input.groupId)),
    }
  },
})

export const setMailGroupManager = defineAction({
  name: "set_mail_group_manager",
  title: "指派群組信管理者",
  description:
    "Portal admins only: makes a member (userId from list_members) a manager of one mailing list (manager true) or takes it away (false). Managers change the list's MEMBER rows, nothing else.",
  kind: "mutation",
  input: z.object({ groupId, userId: z.uuid(), manager: z.boolean() }),
  run: async (actor, input) => {
    await requireAdmin(actor, "portal")
    const id = parseGroupId(input.groupId)
    if (!id) throw new Error("群組 id 格式不對")
    if (input.manager) {
      const api = groupsApiFromEnv()
      if (!api) throw new Error("Google 群組整合尚未設定")
      const group = await getGroup(api, id).catch((error) => {
        console.error("[groups] group read failed", error)
        throw new Error("讀不到這個 Google 群組，請稍後再試")
      })
      if (!group || !isManageableGroup(group.email, api.domain))
        throw new Error("這個群組不存在，或不開放給 portal 管理")
      await db
        .insert(groupManagers)
        .values({ groupId: group.id, userId: input.userId })
        .onConflictDoNothing()
    } else
      await db
        .delete(groupManagers)
        .where(
          and(
            eq(groupManagers.groupId, id),
            eq(groupManagers.userId, input.userId)
          )
        )
    return { groupId: id, userId: input.userId, manager: input.manager }
  },
})

export const listCohorts = defineAction({
  name: "list_cohorts",
  title: "入學年度名單",
  description:
    "The lab's cohorts from Keycloak (/lab-member/114, 113, …), newest first, each with its current members' names and addresses (alumni left out), for adding a whole cohort to a mailing list. Managers of any list and portal admins only. null when Keycloak cannot be read in time.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const any =
      (await isAdmin(actor, "portal")) ||
      (
        await db
          .select({ groupId: groupManagers.groupId })
          .from(groupManagers)
          .where(eq(groupManagers.userId, actor.userId))
          .limit(1)
      ).length > 0
    if (!any) throw new Error("只有群組信管理者可以看")
    const [cohorts, directory] = await Promise.all([
      fetchCohorts(),
      labDirectory().catch(() => null),
    ])
    // Alumni stay in their cohort group but no longer want lab mail.
    return {
      cohorts:
        cohorts?.map((cohort) => ({
          ...cohort,
          members: cohort.members.filter(
            (m) => directory?.get(m.id)?.status !== "alumni"
          ),
        })) ?? null,
    }
  },
})
