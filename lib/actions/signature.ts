import { eq } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { signatures } from "@/lib/db/schema"
import { checkSignatureImage } from "@/lib/pdf-sign/image"

/** Largest signature image accepted, in bytes. */
const SIGNATURE_LIMIT = 1024 * 1024
const corners = ["tl", "tr", "bl", "br"] as const

const imageOff =
  "a member's signature image is drawn by them on the page; an agent never supplies or holds one"

export const getMySignature = defineAction({
  name: "get_my_signature",
  title: "我的簽名設定",
  description:
    "Whether the signed-in member has saved a handwritten signature, whether it is drawn on documents they upload (stamp), and in which corner of the first page (tl, tr, bl, br). The image itself stays on the web.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [row] = await db
      .select({
        hasImage: signatures.image,
        stamp: signatures.stamp,
        corner: signatures.corner,
        updatedAt: signatures.updatedAt,
      })
      .from(signatures)
      .where(eq(signatures.userId, actor.userId))
    return {
      hasImage: Boolean(row?.hasImage),
      stamp: row?.stamp ?? true,
      corner: row?.corner ?? "br",
      updatedAt: row?.updatedAt ?? null,
    }
  },
})

export const getMySignatureImage = defineAction({
  name: "get_my_signature_image",
  title: "我的簽名",
  description: "The signed-in member's signature image as a data URL.",
  kind: "query",
  mcpExcludedBecause: imageOff,
  input: z.object({}),
  run: async (actor) => {
    const [row] = await db
      .select({ contentType: signatures.contentType, image: signatures.image })
      .from(signatures)
      .where(eq(signatures.userId, actor.userId))
    return {
      dataUrl:
        row?.image && row.contentType
          ? `data:${row.contentType};base64,${row.image.toString("base64")}`
          : null,
    }
  },
})

export const setMySignature = defineAction({
  name: "set_my_signature",
  title: "儲存簽名",
  description: "Saves the signed-in member's handwritten signature.",
  kind: "mutation",
  mcpExcludedBecause: imageOff,
  input: z.object({
    dataUrl: z
      .string()
      .regex(
        /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/,
        "簽名要是 PNG 或 JPEG"
      ),
  }),
  run: async (actor, { dataUrl }) => {
    const [, type, base64] = /^data:image\/(png|jpeg);base64,(.+)$/.exec(
      dataUrl
    )!
    const image = Buffer.from(base64, "base64")
    if (image.length > SIGNATURE_LIMIT) throw new Error("簽名圖片最大 1 MB")
    checkSignatureImage(image, `image/${type}`)
    const values = {
      userId: actor.userId,
      contentType: `image/${type}`,
      image,
      updatedAt: new Date(),
    }
    await db
      .insert(signatures)
      .values(values)
      .onConflictDoUpdate({ target: signatures.userId, set: values })
    return { saved: true }
  },
})

export const setSignatureSettings = defineAction({
  name: "set_signature_settings",
  title: "簽名設定",
  description:
    "Sets whether the signed-in member's signature is drawn on page 1 of documents they upload (stamp) and the corner of the first page (tl, tr, bl, br). Leave out what stays the same.",
  kind: "mutation",
  input: z.object({
    stamp: z.boolean().optional(),
    corner: z.enum(corners).optional(),
  }),
  run: async (actor, changes) => {
    const values = { ...changes, updatedAt: new Date() }
    await db
      .insert(signatures)
      .values({ userId: actor.userId, ...values })
      .onConflictDoUpdate({ target: signatures.userId, set: values })
    return changes
  },
})
