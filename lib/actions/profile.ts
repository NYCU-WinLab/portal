import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { account } from "@/lib/db/schema"
import { getKeycloakUser, getKeycloakUserGroupPaths } from "@/lib/keycloak"

export const getProfile = defineAction({
  name: "get_profile",
  title: "我的資料",
  description:
    "The signed-in member's lab account from Keycloak: Chinese name, English family and given names, account name, email, student id, and the Keycloak groups they are in (paths without the leading slash, e.g. lab-member/114). Read only; members change these in Keycloak's account console.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [link] = await db
      .select({ sub: account.accountId })
      .from(account)
      .where(
        and(
          eq(account.userId, actor.userId),
          eq(account.providerId, "keycloak")
        )
      )
      .orderBy(desc(account.updatedAt))
      .limit(1)
    if (!link) throw new Error("這個帳號沒有連到 Keycloak")
    const [user, groupPaths] = await Promise.all([
      getKeycloakUser(link.sub),
      getKeycloakUserGroupPaths(link.sub),
    ])
    const attribute = (key: string) => user.attributes?.[key]?.[0] ?? null
    return {
      chineseName: attribute("chinese_name"),
      lastName: user.lastName ?? null,
      firstName: user.firstName ?? null,
      username: user.username,
      email: user.email ?? null,
      studentId: attribute("student_id"),
      groups: groupPaths.map((path) => path.replace(/^\//, "")),
    }
  },
})
