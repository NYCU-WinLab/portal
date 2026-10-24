import { eq, isNull } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { AVATAR_MAX_BYTES, avatarImages } from "@/lib/avatar"
import { db } from "@/lib/db"
import { memberAvatars, user } from "@/lib/db/schema"
import { gravatarImage } from "@/lib/gravatar"

// Members' pictures: each member sets their own, every signed-in member
// sees them, portal admins can take one down.

const member = z.uuid("找不到這位成員")

async function store(userId: string, bytes: Buffer) {
  const { small, large } = await avatarImages(bytes)
  const version = crypto.randomUUID()
  await db
    .insert(memberAvatars)
    .values({ userId, small, large, version })
    .onConflictDoUpdate({
      target: memberAvatars.userId,
      set: { small, large, version, updatedAt: new Date() },
    })
  return version
}

export const setMyAvatar = defineAction({
  name: "set_my_avatar",
  title: "設定我的頭像",
  description:
    "Sets the signed-in member's avatar from base64 png, jpg or webp (up to 5 MB). The portal crops it to a centred square and stores it again as WebP without EXIF; every signed-in lab member can see it.",
  kind: "mutation",
  input: z.object({
    base64: z
      .base64("檔案要是 base64")
      .max(Math.ceil((AVATAR_MAX_BYTES * 4) / 3) + 4, "圖片超過 5 MB"),
  }),
  run: async (actor, input) => ({
    version: await store(actor.userId, Buffer.from(input.base64, "base64")),
  }),
})

export const loadMyGravatar = defineAction({
  name: "load_my_gravatar",
  title: "從 Gravatar 載入頭像",
  description:
    "Replaces the signed-in member's avatar with the Gravatar of their portal email; fails when that email has no Gravatar.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    const [me] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, actor.userId))
    const bytes = me && (await gravatarImage(me.email))
    if (!bytes) throw new Error("這個信箱沒有 Gravatar")
    return { version: await store(actor.userId, bytes) }
  },
})

export const loadGravatars = defineAction({
  name: "load_gravatars",
  admin: "portal",
  title: "載入成員的 Gravatar",
  description:
    "Portal admins only: gives every member without an avatar their Gravatar, when their portal email has one. Members who uploaded a picture keep it. Returns how many were checked and loaded.",
  kind: "mutation",
  input: z.object({}),
  run: async () => {
    const members = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .leftJoin(memberAvatars, eq(memberAvatars.userId, user.id))
      .where(isNull(memberAvatars.userId))
    let loaded = 0
    for (const { id, email } of members) {
      const bytes = await gravatarImage(email).catch(() => null)
      if (!bytes) continue
      await store(id, bytes)
      loaded++
    }
    return { checked: members.length, loaded }
  },
})

export const removeMyAvatar = defineAction({
  name: "remove_my_avatar",
  title: "移除我的頭像",
  description:
    "Removes the signed-in member's avatar; their initial shows instead.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    await db.delete(memberAvatars).where(eq(memberAvatars.userId, actor.userId))
    return { removed: true }
  },
})

export const removeMemberAvatar = defineAction({
  name: "remove_member_avatar",
  admin: "portal",
  title: "移除成員頭像",
  description:
    "Portal admins only: removes one member's avatar (user_id from list_members).",
  kind: "mutation",
  input: z.object({ user_id: member }),
  run: async (actor, input) => {
    const removed = await db
      .delete(memberAvatars)
      .where(eq(memberAvatars.userId, input.user_id))
      .returning({ userId: memberAvatars.userId })
    return { removed: removed.length > 0 }
  },
})

export const getMemberAvatar = defineAction({
  name: "get_member_avatar",
  title: "成員頭像",
  description:
    "One member's avatar as base64 WebP (size small 96px or large 256px) with its version, or null when they have none. Any signed-in member may look.",
  kind: "query",
  input: z.object({
    user_id: member,
    size: z.enum(["small", "large"]).default("small"),
  }),
  run: async (_actor, input) => {
    const [row] = await db
      .select({
        image:
          input.size === "large" ? memberAvatars.large : memberAvatars.small,
        version: memberAvatars.version,
      })
      .from(memberAvatars)
      .where(eq(memberAvatars.userId, input.user_id))
    return row
      ? {
          contentType: "image/webp",
          version: row.version,
          base64: row.image.toString("base64"),
        }
      : null
  },
})
