import { and, asc, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { isAdmin, requireAdmin } from "@/lib/actions/authz"
import { loadMenu, loadOptionGroups } from "@/lib/actions/bento-restaurants"
import { type Actor, defineAction } from "@/lib/actions/define"
import type { Tx } from "@/lib/actions/meetings-shared"
import { db } from "@/lib/db"
import {
  type BentoLineOption,
  bentoMenuImages,
  bentoMenuItems,
  bentoOrderItems,
  bentoOrders,
  bentoRestaurants,
  user,
} from "@/lib/db/schema"
import { taipeiToday } from "@/lib/leave-dates"

const id = z.uuid("id 格式不對")
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD")

/** Which batch of its day an order is: 1 unless the day has several. */
const batch =
  sql<number>`row_number() over (partition by ${bentoOrders.date} order by ${bentoOrders.createdAt})`.mapWith(
    Number
  )
const dayOrders =
  sql<number>`count(*) over (partition by ${bentoOrders.date})`.mapWith(Number)

/** The order row, locked for the rest of the transaction; open unless any. */
async function lockOrder(tx: Tx, orderId: string, open = true) {
  const [order] = await tx
    .select()
    .from(bentoOrders)
    .where(eq(bentoOrders.id, orderId))
    .for("update")
  if (!order) throw new Error("找不到這張訂單")
  if (open && order.status !== "open") throw new Error("這張訂單已經關了")
  return order
}

export const listBentoOrders = defineAction({
  name: "list_bento_orders",
  title: "訂單",
  description:
    "Lunch orders, newest first: id, date, batch (the nth order of that day, when a day has several), restaurant, status (open takes orders, closed has been sent), how many people and dishes, and the total in NT$. Every member sees every order. Filter by status; limit defaults to 30.",
  kind: "query",
  input: z.object({
    status: z.enum(["open", "closed"]).optional(),
    limit: z.number().int().min(1).max(200).default(30),
  }),
  run: async (_actor, { status, limit }) => {
    const ordered = db
      .select({
        id: bentoOrders.id,
        date: bentoOrders.date,
        status: bentoOrders.status,
        createdAt: bentoOrders.createdAt,
        restaurantId: bentoOrders.restaurantId,
        batch: batch.as("batch"),
        batches: dayOrders.as("batches"),
      })
      .from(bentoOrders)
      .as("ordered")
    const totals = db
      .select({
        orderId: bentoOrderItems.orderId,
        people: sql<number>`count(distinct ${bentoOrderItems.userId})`
          .mapWith(Number)
          .as("people"),
        dishes: sql<number>`count(*)`.mapWith(Number).as("dishes"),
        total: sql<number>`sum(${bentoOrderItems.price})`
          .mapWith(Number)
          .as("total"),
      })
      .from(bentoOrderItems)
      .groupBy(bentoOrderItems.orderId)
      .as("totals")
    const rows = await db
      .select({
        id: ordered.id,
        date: ordered.date,
        status: ordered.status,
        batch: ordered.batch,
        batches: ordered.batches,
        restaurantId: ordered.restaurantId,
        restaurant: bentoRestaurants.name,
        people: totals.people,
        dishes: totals.dishes,
        total: totals.total,
      })
      .from(ordered)
      .innerJoin(
        bentoRestaurants,
        eq(bentoRestaurants.id, ordered.restaurantId)
      )
      .leftJoin(totals, eq(totals.orderId, ordered.id))
      .where(status ? eq(ordered.status, status) : undefined)
      .orderBy(desc(ordered.date), desc(ordered.createdAt))
      .limit(limit)
    return {
      orders: rows.map(({ batches, ...row }) => ({
        ...row,
        batch: batches > 1 ? row.batch : null,
        people: row.people ?? 0,
        dishes: row.dishes ?? 0,
        total: row.total ?? 0,
      })),
    }
  },
})

/** "半糖、少冰": the options a line was ordered with, by label. */
const comboKey = (options: BentoLineOption[]) =>
  options.map((option) => option.label).join("、")

export const getBentoOrder = defineAction({
  name: "get_bento_order",
  title: "訂單內容",
  description:
    "One lunch order in full: the order (date, batch, status), its restaurant with the menu and option groups to order from, every line (id, member, dish, picked options, price), totals per member, and a tally per dish and option combination as the restaurant would take it.",
  kind: "query",
  input: z.object({ orderId: id }),
  run: async (_actor, { orderId }) => {
    const [order] = await db
      .select({
        id: bentoOrders.id,
        date: bentoOrders.date,
        status: bentoOrders.status,
        closedAt: bentoOrders.closedAt,
        createdAt: bentoOrders.createdAt,
        restaurantId: bentoOrders.restaurantId,
      })
      .from(bentoOrders)
      .where(eq(bentoOrders.id, orderId))
    if (!order) throw new Error("找不到這張訂單")
    const [[restaurant], sameDay, lines, menu, optionGroups] =
      await Promise.all([
        db
          .select({
            id: bentoRestaurants.id,
            name: bentoRestaurants.name,
            phone: bentoRestaurants.phone,
            mapUrl: bentoRestaurants.mapUrl,
            menuImage: bentoMenuImages.updatedAt,
          })
          .from(bentoRestaurants)
          .leftJoin(
            bentoMenuImages,
            eq(bentoMenuImages.restaurantId, bentoRestaurants.id)
          )
          .where(eq(bentoRestaurants.id, order.restaurantId)),
        db
          .select({ id: bentoOrders.id })
          .from(bentoOrders)
          .where(eq(bentoOrders.date, order.date))
          .orderBy(asc(bentoOrders.createdAt)),
        db
          .select({
            id: bentoOrderItems.id,
            userId: bentoOrderItems.userId,
            member: user.name,
            name: bentoOrderItems.name,
            options: bentoOrderItems.options,
            price: bentoOrderItems.price,
            createdAt: bentoOrderItems.createdAt,
          })
          .from(bentoOrderItems)
          .innerJoin(user, eq(user.id, bentoOrderItems.userId))
          .where(eq(bentoOrderItems.orderId, orderId))
          .orderBy(asc(bentoOrderItems.createdAt)),
        loadMenu(order.restaurantId),
        loadOptionGroups(order.restaurantId),
      ])

    const people = new Map<
      string,
      { userId: string; name: string; total: number; lines: typeof lines }
    >()
    const dishes = new Map<
      string,
      {
        name: string
        count: number
        combos: Map<
          string,
          { options: string; count: number; people: string[] }
        >
      }
    >()
    for (const line of lines) {
      const person = people.get(line.userId) ?? {
        userId: line.userId,
        name: line.member,
        total: 0,
        lines: [],
      }
      person.total += line.price
      person.lines.push(line)
      people.set(line.userId, person)

      const dish = dishes.get(line.name) ?? {
        name: line.name,
        count: 0,
        combos: new Map(),
      }
      dish.count += 1
      const key = comboKey(line.options)
      const combo = dish.combos.get(key) ?? {
        options: key,
        count: 0,
        people: [],
      }
      combo.count += 1
      if (!combo.people.includes(line.member)) combo.people.push(line.member)
      dish.combos.set(key, combo)
      dishes.set(line.name, dish)
    }

    const index = sameDay.findIndex((row) => row.id === order.id)
    return {
      order: {
        ...order,
        batch: sameDay.length > 1 ? index + 1 : null,
      },
      restaurant: {
        ...restaurant,
        menuImage: restaurant.menuImage ? restaurant.menuImage.getTime() : null,
      },
      menu,
      optionGroups,
      lines,
      people: [...people.values()].sort(
        (a, b) => b.total - a.total || a.name.localeCompare(b.name)
      ),
      dishes: [...dishes.values()]
        .map((dish) => ({
          name: dish.name,
          count: dish.count,
          combos: [...dish.combos.values()].sort((a, b) => b.count - a.count),
        }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      totals: {
        people: people.size,
        dishes: lines.length,
        total: lines.reduce((sum, line) => sum + line.price, 0),
      },
    }
  },
})

export const addBentoOrderItem = defineAction({
  name: "add_bento_order_item",
  title: "點餐",
  description:
    "Orders one or more dishes on an open order for the signed-in member, all or nothing. Each item has menuItemId from the order's menu (get_bento_order), optionValueIds picking one value in every required group and at most one in a group that is not multiple, and quantity (1 to 10 lines). A bento admin may order for another member with userId. Confirm the dishes and options with the member first.",
  kind: "mutation",
  input: z.object({
    orderId: id,
    items: z
      .array(
        z.object({
          menuItemId: id,
          optionValueIds: z.array(id).max(30).default([]),
          quantity: z
            .number()
            .int()
            .min(1, "至少 1 份")
            .max(10, "最多 10 份")
            .default(1),
        })
      )
      .min(1, "至少點一道")
      .max(20, "一次最多 20 道"),
    userId: id.optional(),
  }),
  run: async (actor, { orderId, items, userId }) => {
    const forUser = userId ?? actor.userId
    if (forUser !== actor.userId) await requireAdmin(actor, "bento")
    return db.transaction(async (tx) => {
      const order = await lockOrder(tx, orderId)
      const groups = await loadOptionGroups(order.restaurantId)
      const dishes = await tx
        .select()
        .from(bentoMenuItems)
        .where(eq(bentoMenuItems.restaurantId, order.restaurantId))
      const ordered = []
      for (const item of items) {
        const dish = dishes.find((row) => row.id === item.menuItemId)
        if (!dish) throw new Error("有菜不在這家餐廳的菜單上")
        const picked = new Set(item.optionValueIds)
        const options: BentoLineOption[] = []
        let price = dish.price
        for (const group of groups) {
          const values = group.values.filter((value) => picked.has(value.id))
          if (group.required && values.length === 0)
            throw new Error(`${dish.name}請選${group.name}`)
          if (!group.multiple && values.length > 1)
            throw new Error(`${dish.name}的${group.name}只能選一個`)
          for (const value of values) {
            picked.delete(value.id)
            options.push({ group: group.name, label: value.label })
            price += value.priceDelta
          }
        }
        if (picked.size > 0) throw new Error("有選項不屬於這家餐廳")
        for (let n = 0; n < item.quantity; n++)
          ordered.push({
            orderId,
            userId: forUser,
            menuItemId: dish.id,
            name: dish.name,
            options,
            price,
          })
      }
      const lines = await tx.insert(bentoOrderItems).values(ordered).returning({
        id: bentoOrderItems.id,
        name: bentoOrderItems.name,
        price: bentoOrderItems.price,
      })
      return {
        lines,
        total: lines.reduce((sum, line) => sum + line.price, 0),
      }
    })
  },
})

export const removeBentoOrderItem = defineAction({
  name: "remove_bento_order_item",
  title: "刪除餐點",
  description:
    "Removes one line from an open order: the member's own, or anyone's for a bento admin. lineId comes from get_bento_order.",
  kind: "mutation",
  input: z.object({ lineId: id }),
  run: async (actor, { lineId }) => {
    const [line] = await db
      .select({
        orderId: bentoOrderItems.orderId,
        userId: bentoOrderItems.userId,
      })
      .from(bentoOrderItems)
      .where(eq(bentoOrderItems.id, lineId))
    if (!line) throw new Error("找不到這份餐點")
    if (line.userId !== actor.userId) await requireAdmin(actor, "bento")
    return db.transaction(async (tx) => {
      await lockOrder(tx, line.orderId)
      await tx.delete(bentoOrderItems).where(eq(bentoOrderItems.id, lineId))
      return { lineId }
    })
  },
})

export const copyBentoOrder = defineAction({
  name: "copy_bento_order",
  title: "偷學",
  description:
    "Copies another member's lines on an open order as the signed-in member's own, replacing whatever the member had ordered there. Prices and options are copied as they were ordered.",
  kind: "mutation",
  input: z.object({ orderId: id, fromUserId: id }),
  run: async (actor, { orderId, fromUserId }) => {
    if (fromUserId === actor.userId) throw new Error("不能偷學自己")
    return db.transaction(async (tx) => {
      await lockOrder(tx, orderId)
      const source = await tx
        .select()
        .from(bentoOrderItems)
        .where(
          and(
            eq(bentoOrderItems.orderId, orderId),
            eq(bentoOrderItems.userId, fromUserId)
          )
        )
        .orderBy(asc(bentoOrderItems.createdAt))
      if (source.length === 0) throw new Error("對方在這張訂單沒有點餐")
      await tx
        .delete(bentoOrderItems)
        .where(
          and(
            eq(bentoOrderItems.orderId, orderId),
            eq(bentoOrderItems.userId, actor.userId)
          )
        )
      await tx.insert(bentoOrderItems).values(
        source.map((line) => ({
          orderId,
          userId: actor.userId,
          menuItemId: line.menuItemId,
          name: line.name,
          options: line.options,
          price: line.price,
        }))
      )
      return { lines: source.length }
    })
  },
})

export const createBentoOrder = defineAction({
  name: "create_bento_order",
  title: "開單",
  description:
    "Opens a lunch order to one active restaurant (bento admins only). date defaults to today in Taipei; a day may have several orders.",
  kind: "mutation",
  input: z.object({ restaurantId: id, date: isoDate.optional() }),
  run: async (actor, { restaurantId, date }) => {
    await requireAdmin(actor, "bento")
    const [restaurant] = await db
      .select({ active: bentoRestaurants.active })
      .from(bentoRestaurants)
      .where(eq(bentoRestaurants.id, restaurantId))
    if (!restaurant) throw new Error("找不到這家餐廳")
    if (!restaurant.active) throw new Error("這家餐廳停用了")
    const [created] = await db
      .insert(bentoOrders)
      .values({
        restaurantId,
        date: date ?? taipeiToday(),
        createdBy: actor.userId,
      })
      .returning({ id: bentoOrders.id, date: bentoOrders.date })
    return created
  },
})

const setStatus =
  (status: "open" | "closed") =>
  async (actor: Actor, { orderId }: { orderId: string }) => {
    await requireAdmin(actor, "bento")
    const [updated] = await db
      .update(bentoOrders)
      .set({ status, closedAt: status === "closed" ? new Date() : null })
      .where(eq(bentoOrders.id, orderId))
      .returning({ id: bentoOrders.id, status: bentoOrders.status })
    if (!updated) throw new Error("找不到這張訂單")
    return updated
  }

export const closeBentoOrder = defineAction({
  name: "close_bento_order",
  title: "關單",
  description:
    "Closes an order once it is sent to the restaurant (bento admins only): no more lines can be added, removed or copied.",
  kind: "mutation",
  input: z.object({ orderId: id }),
  run: setStatus("closed"),
})

export const reopenBentoOrder = defineAction({
  name: "reopen_bento_order",
  title: "重開訂單",
  description:
    "Opens a closed order again so members can change their lines (bento admins only).",
  kind: "mutation",
  input: z.object({ orderId: id }),
  run: setStatus("open"),
})

export const deleteBentoOrder = defineAction({
  name: "delete_bento_order",
  title: "刪除訂單",
  description:
    "Deletes an order with every line on it (bento admins only). It cannot be undone; confirm with the member first.",
  kind: "mutation",
  input: z.object({ orderId: id }),
  run: async (actor, { orderId }) => {
    await requireAdmin(actor, "bento")
    const removed = await db
      .delete(bentoOrders)
      .where(eq(bentoOrders.id, orderId))
      .returning({ id: bentoOrders.id })
    if (removed.length === 0) throw new Error("找不到這張訂單")
    return { orderId }
  },
})

export const getBentoStats = defineAction({
  name: "get_bento_stats",
  title: "便當統計",
  description:
    "How much each member has ordered: dishes, NT$ spent and their most-ordered dish, over every order. A bento admin sees every member; anyone else sees only themselves.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const admin = await isAdmin(actor, "bento")
    const rows = await db
      .select({
        userId: bentoOrderItems.userId,
        name: user.name,
        dish: bentoOrderItems.name,
        count: sql<number>`count(*)`.mapWith(Number),
        spent: sql<number>`sum(${bentoOrderItems.price})`.mapWith(Number),
      })
      .from(bentoOrderItems)
      .innerJoin(user, eq(user.id, bentoOrderItems.userId))
      .where(admin ? undefined : eq(bentoOrderItems.userId, actor.userId))
      .groupBy(bentoOrderItems.userId, user.name, bentoOrderItems.name)
    const members = new Map<
      string,
      {
        userId: string
        name: string
        dishes: number
        kinds: number
        spent: number
        favorite: { name: string; count: number } | null
      }
    >()
    for (const row of rows) {
      const member = members.get(row.userId) ?? {
        userId: row.userId,
        name: row.name,
        dishes: 0,
        kinds: 0,
        spent: 0,
        favorite: null,
      }
      member.dishes += row.count
      member.kinds += 1
      member.spent += row.spent
      if (
        !member.favorite ||
        row.count > member.favorite.count ||
        (row.count === member.favorite.count &&
          row.dish.localeCompare(member.favorite.name) < 0)
      )
        member.favorite = { name: row.dish, count: row.count }
      members.set(row.userId, member)
    }
    return {
      members: [...members.values()].sort(
        (a, b) => b.dishes - a.dishes || a.name.localeCompare(b.name)
      ),
    }
  },
})
