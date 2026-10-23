"use server"

import { revalidatePath } from "next/cache"

import { errorMessage, runAction } from "@/lib/actions/define"
import {
  addMailGroupMembers,
  listCohorts,
  removeMailGroupMember,
  setMailGroupManager,
} from "@/lib/actions/groups"
import { requireActor } from "@/lib/auth/session"

// The page's writes: the same actions MCP runs.

async function attempt<T>(path: string, run: () => Promise<T>) {
  try {
    const result = await run()
    revalidatePath(path)
    return { result }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

export async function addMembers(groupId: string, emails: string[]) {
  const actor = await requireActor("/groups")
  return attempt(`/groups/${groupId}`, () =>
    runAction(addMailGroupMembers, actor, { groupId, emails })
  )
}

export async function removeMember(groupId: string, email: string) {
  const actor = await requireActor("/groups")
  return attempt(`/groups/${groupId}`, () =>
    runAction(removeMailGroupMember, actor, { groupId, email })
  )
}

export async function setManager(
  groupId: string,
  userId: string,
  manager: boolean
) {
  const actor = await requireActor("/groups")
  return attempt(`/groups/${groupId}`, () =>
    runAction(setMailGroupManager, actor, { groupId, userId, manager })
  )
}

export async function loadCohorts() {
  const actor = await requireActor("/groups")
  return attempt("/groups", () => runAction(listCohorts, actor, {}))
}
