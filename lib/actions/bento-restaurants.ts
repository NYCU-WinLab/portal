import { and, asc, count, desc, eq, inArray, notInArray } from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  bentoMenuImages,
  bentoMenuItems,
  bentoOptionGroups,
  bentoOptionValues,
  bentoOrders,
  bentoRestaurants,
} from "@/lib/db/schema"

const id = z.uuid("id 格式不對")
const name = (label: string) =>
  z.string().trim().min(1, `請填${label}`).max(100, `${label}最多 100 字`)
const mapUrl = z
  .union([z.url("地圖連結要是網址"), z.literal("")])
  .nullish()
  .transform((url) => url || null)

/** Largest menu image accepted, in bytes. */
export const MENU_IMAGE_LIMIT = 4 * 1024 * 1024
const imageTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"]

export type OptionGroup = {
  id: string
  name: string
  required: boolean
  multiple: boolean
  values: { id: string; label: string; priceDelta: number }[]
}

/** A restaurant's option groups with their values, in menu order. */
export async function loadOptionGroups(
  restaurantId: string
): Promise<OptionGroup[]> {
  const rows = await db
    .select({
      groupId: bentoOptionGroups.id,
      name: bentoOptionGroups.name,
      required: bentoOptionGroups.required,
      multiple: bentoOptionGroups.multiple,
      valueId: bentoOptionValues.id,
      label: bentoOptionValues.label,
      priceDelta: bentoOptionValues.priceDelta,
    })
    .from(bentoOptionGroups)
    .leftJoin(
      bentoOptionValues,
      eq(bentoOptionValues.groupId, bentoOptionGroups.id)
    )
    .where(eq(bentoOptionGroups.restaurantId, restaurantId))
    .orderBy(asc(bentoOptionGroups.position), asc(bentoOptionValues.position))
  const groups = new Map<string, OptionGroup>()
  for (const row of rows) {
    const group = groups.get(row.groupId) ?? {
      id: row.groupId,
      name: row.name,
      required: row.required,
      multiple: row.multiple,
      values: [],
    }
    groups.set(row.groupId, group)
    if (row.valueId && row.label !== null)
      group.values.push({
        id: row.valueId,
        label: row.label,
        priceDelta: row.priceDelta ?? 0,
      })
  }
  return [...groups.values()]
}

/** A restaurant's dishes, by menu heading then price. */
export async function loadMenu(restaurantId: string) {
  return db
    .select({
      id: bentoMenuItems.id,
      category: bentoMenuItems.category,
      name: bentoMenuItems.name,
      price: bentoMenuItems.price,
    })
    .from(bentoMenuItems)
    .where(eq(bentoMenuItems.restaurantId, restaurantId))
    .orderBy(
      asc(bentoMenuItems.category),
      asc(bentoMenuItems.price),
      asc(bentoMenuItems.name)
    )
}

async function findRestaurant(restaurantId: string) {
  const [restaurant] = await db
    .select()
    .from(bentoRestaurants)
    .where(eq(bentoRestaurants.id, restaurantId))
  if (!restaurant) throw new Error("找不到這家餐廳")
  return restaurant
}

export const listBentoRestaurants = defineAction({
  name: "list_bento_restaurants",
  title: "餐廳",
  description:
    "Restaurants the lab orders lunch from, pinned first, then by name: id, name, phone, map link, how many dishes, whether a menu photo exists. Switched-off restaurants are listed only for bento admins (active false). Use get_bento_restaurant for the menu.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const admin = await isAdmin(actor, "bento")
    const rows = await db
      .select({
        id: bentoRestaurants.id,
        name: bentoRestaurants.name,
        phone: bentoRestaurants.phone,
        mapUrl: bentoRestaurants.mapUrl,
        active: bentoRestaurants.active,
        pinned: bentoRestaurants.pinned,
        dishes: count(bentoMenuItems.id),
        image: bentoMenuImages.updatedAt,
      })
      .from(bentoRestaurants)
      .leftJoin(
        bentoMenuItems,
        eq(bentoMenuItems.restaurantId, bentoRestaurants.id)
      )
      .leftJoin(
        bentoMenuImages,
        eq(bentoMenuImages.restaurantId, bentoRestaurants.id)
      )
      .where(admin ? undefined : eq(bentoRestaurants.active, true))
      .groupBy(bentoRestaurants.id, bentoMenuImages.updatedAt)
      .orderBy(
        desc(bentoRestaurants.active),
        desc(bentoRestaurants.pinned),
        asc(bentoRestaurants.name)
      )
    return {
      restaurants: rows.map(({ image, ...row }) => ({
        ...row,
        menuImage: image ? image.getTime() : null,
      })),
    }
  },
})

export const getBentoRestaurant = defineAction({
  name: "get_bento_restaurant",
  title: "菜單",
  description:
    "One restaurant with its menu: dishes (id, category heading, name, price in NT$) and option groups (甜度, 冰量, 加料, 不醬...; required means every dish needs one pick, multiple means several may be picked; priceDelta is added to the dish).",
  kind: "query",
  input: z.object({ restaurantId: id }),
  run: async (actor, { restaurantId }) => {
    const restaurant = await findRestaurant(restaurantId)
    if (!restaurant.active && !(await isAdmin(actor, "bento")))
      throw new Error("找不到這家餐廳")
    const [menu, optionGroups] = await Promise.all([
      loadMenu(restaurantId),
      loadOptionGroups(restaurantId),
    ])
    return { restaurant, menu, optionGroups }
  },
})

export const getBentoMenuImage = defineAction({
  name: "get_bento_menu_image",
  title: "菜單照片",
  description:
    "The photographed menu of one restaurant as base64 with its content type, or null when it has none. Use it when the typed menu is missing a dish.",
  kind: "query",
  input: z.object({ restaurantId: id }),
  run: async (_actor, { restaurantId }) => {
    const [image] = await db
      .select({
        contentType: bentoMenuImages.contentType,
        data: bentoMenuImages.data,
      })
      .from(bentoMenuImages)
      .where(eq(bentoMenuImages.restaurantId, restaurantId))
    return {
      image: image
        ? {
            contentType: image.contentType,
            base64: image.data.toString("base64"),
          }
        : null,
    }
  },
})

const restaurantFields = {
  name: name("店名"),
  phone: z.string().trim().min(1, "請填電話").max(40, "電話最多 40 字"),
  mapUrl,
}

export const createBentoRestaurant = defineAction({
  name: "create_bento_restaurant",
  title: "新增餐廳",
  description:
    "Adds a restaurant (bento admins only). Add its dishes after with set_bento_menu and its options with set_bento_option_groups.",
  kind: "mutation",
  input: z.object(restaurantFields),
  run: async (actor, input) => {
    await requireAdmin(actor, "bento")
    const [created] = await db
      .insert(bentoRestaurants)
      .values(input)
      .returning({ id: bentoRestaurants.id, name: bentoRestaurants.name })
    return created
  },
})

export const updateBentoRestaurant = defineAction({
  name: "update_bento_restaurant",
  title: "修改餐廳",
  description:
    "Changes a restaurant's name, phone or map link, pins it to the top (pinned), or switches it off (active false: no new orders, hidden from members; past orders stay). Bento admins only; leave out what stays the same.",
  kind: "mutation",
  input: z.object({
    restaurantId: id,
    name: restaurantFields.name.optional(),
    phone: restaurantFields.phone.optional(),
    mapUrl: z
      .union([z.url("地圖連結要是網址"), z.literal("")])
      .nullish()
      .transform((url) => (url === undefined ? undefined : url || null)),
    active: z.boolean().optional(),
    pinned: z.boolean().optional(),
  }),
  run: async (actor, { restaurantId, ...changes }) => {
    await requireAdmin(actor, "bento")
    const [updated] = await db
      .update(bentoRestaurants)
      .set(changes)
      .where(eq(bentoRestaurants.id, restaurantId))
      .returning({ id: bentoRestaurants.id, name: bentoRestaurants.name })
    if (!updated) throw new Error("找不到這家餐廳")
    return updated
  },
})

export const deleteBentoRestaurant = defineAction({
  name: "delete_bento_restaurant",
  title: "刪除餐廳",
  description:
    "Deletes a restaurant with its menu (bento admins only). Refused once it has any order; switch it off with update_bento_restaurant instead.",
  kind: "mutation",
  input: z.object({ restaurantId: id }),
  run: async (actor, { restaurantId }) => {
    await requireAdmin(actor, "bento")
    const [used] = await db
      .select({ id: bentoOrders.id })
      .from(bentoOrders)
      .where(eq(bentoOrders.restaurantId, restaurantId))
      .limit(1)
    if (used) throw new Error("這家餐廳有訂單，改成停用")
    const removed = await db
      .delete(bentoRestaurants)
      .where(eq(bentoRestaurants.id, restaurantId))
      .returning({ id: bentoRestaurants.id })
    if (removed.length === 0) throw new Error("找不到這家餐廳")
    return { restaurantId }
  },
})

export const setBentoMenu = defineAction({
  name: "set_bento_menu",
  title: "編輯菜單",
  description:
    "Replaces a restaurant's whole dish list (bento admins only). Pass every dish that should remain: with its id to keep or change it, without an id to add it; dishes left out are removed. Past orders keep their own copy of names and prices.",
  kind: "mutation",
  input: z.object({
    restaurantId: id,
    items: z
      .array(
        z.object({
          id: id.optional(),
          category: z.string().trim().max(40, "分類最多 40 字").default(""),
          name: name("菜名"),
          price: z
            .number()
            .int("價格要是整數")
            .min(0, "價格不能是負的")
            .max(100000, "價格太大"),
        })
      )
      .max(500, "最多 500 道菜"),
  }),
  run: async (actor, { restaurantId, items }) => {
    await requireAdmin(actor, "bento")
    await findRestaurant(restaurantId)
    return db.transaction(async (tx) => {
      const kept = items.flatMap((item) => (item.id ? [item.id] : []))
      if (kept.length) {
        const existing = await tx
          .select({ id: bentoMenuItems.id })
          .from(bentoMenuItems)
          .where(
            and(
              eq(bentoMenuItems.restaurantId, restaurantId),
              inArray(bentoMenuItems.id, kept)
            )
          )
        if (existing.length !== new Set(kept).size)
          throw new Error("有菜不屬於這家餐廳")
      }
      await tx
        .delete(bentoMenuItems)
        .where(
          and(
            eq(bentoMenuItems.restaurantId, restaurantId),
            kept.length ? notInArray(bentoMenuItems.id, kept) : undefined
          )
        )
      for (const item of items) {
        const values = {
          category: item.category,
          name: item.name,
          price: item.price,
        }
        if (item.id)
          await tx
            .update(bentoMenuItems)
            .set(values)
            .where(eq(bentoMenuItems.id, item.id))
        else await tx.insert(bentoMenuItems).values({ ...values, restaurantId })
      }
      return { restaurantId, dishes: items.length }
    })
  },
})

export const setBentoOptionGroups = defineAction({
  name: "set_bento_option_groups",
  title: "編輯選項",
  description:
    "Replaces a restaurant's option groups (bento admins only), in the order given: name (甜度, 冰量, 不醬), required (every dish needs a pick), multiple (several picks allowed), and values with a label and priceDelta in NT$. Past orders keep the labels they were ordered with.",
  kind: "mutation",
  input: z.object({
    restaurantId: id,
    groups: z
      .array(
        z.object({
          name: name("選項名稱"),
          required: z.boolean().default(false),
          multiple: z.boolean().default(false),
          values: z
            .array(
              z.object({
                label: name("選項"),
                priceDelta: z
                  .number()
                  .int("加價要是整數")
                  .min(-10000)
                  .max(10000)
                  .default(0),
              })
            )
            .min(1, "每組至少一個選項")
            .max(50),
        })
      )
      .max(20, "最多 20 組選項"),
  }),
  run: async (actor, { restaurantId, groups }) => {
    await requireAdmin(actor, "bento")
    await findRestaurant(restaurantId)
    await db.transaction(async (tx) => {
      await tx
        .delete(bentoOptionGroups)
        .where(eq(bentoOptionGroups.restaurantId, restaurantId))
      for (const [position, group] of groups.entries()) {
        const [created] = await tx
          .insert(bentoOptionGroups)
          .values({
            restaurantId,
            name: group.name,
            required: group.required,
            multiple: group.multiple,
            position,
          })
          .returning({ id: bentoOptionGroups.id })
        await tx.insert(bentoOptionValues).values(
          group.values.map((value, index) => ({
            groupId: created.id,
            label: value.label,
            priceDelta: value.priceDelta,
            position: index,
          }))
        )
      }
    })
    return { restaurantId, groups: groups.length }
  },
})

export const setBentoMenuImage = defineAction({
  name: "set_bento_menu_image",
  title: "上傳菜單照片",
  description: `Sets or removes a restaurant's menu photo (bento admins only). image is base64 of a JPEG, PNG, WebP or GIF up to ${MENU_IMAGE_LIMIT / 1024 / 1024} MB; null removes it.`,
  kind: "mutation",
  input: z.object({
    restaurantId: id,
    image: z
      .object({
        contentType: z.enum(imageTypes, "只收 JPEG、PNG、WebP、GIF"),
        base64: z.base64("圖片要是 base64"),
      })
      .nullable(),
  }),
  run: async (actor, { restaurantId, image }) => {
    await requireAdmin(actor, "bento")
    await findRestaurant(restaurantId)
    if (!image) {
      await db
        .delete(bentoMenuImages)
        .where(eq(bentoMenuImages.restaurantId, restaurantId))
      return { restaurantId, image: false }
    }
    const data = Buffer.from(image.base64, "base64")
    if (data.length > MENU_IMAGE_LIMIT)
      throw new Error(
        `圖片最大 ${MENU_IMAGE_LIMIT / 1024 / 1024} MB，這張 ${(data.length / 1024 / 1024).toFixed(1)} MB`
      )
    const values = {
      restaurantId,
      contentType: image.contentType,
      data,
      updatedAt: new Date(),
    }
    await db
      .insert(bentoMenuImages)
      .values(values)
      .onConflictDoUpdate({ target: bentoMenuImages.restaurantId, set: values })
    return { restaurantId, image: true }
  },
})
