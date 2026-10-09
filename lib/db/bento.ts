import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"

import { user } from "@/lib/db/auth-schema"

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

// Restaurants members order lunch from. A restaurant with orders is never
// deleted, only switched off, so past orders keep their restaurant.
export const bentoRestaurants = pgTable("bento_restaurants", {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  phone: text().notNull(),
  mapUrl: text(),
  active: boolean().default(true).notNull(),
  pinned: boolean().default(false).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

// A restaurant's photographed menu, kept apart so listing restaurants never
// loads the bytes.
export const bentoMenuImages = pgTable("bento_menu_images", {
  restaurantId: uuid()
    .primaryKey()
    .references(() => bentoRestaurants.id, { onDelete: "cascade" }),
  contentType: text().notNull(),
  data: bytea().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
})

export const bentoMenuItems = pgTable(
  "bento_menu_items",
  {
    id: uuid().defaultRandom().primaryKey(),
    restaurantId: uuid()
      .notNull()
      .references(() => bentoRestaurants.id, { onDelete: "cascade" }),
    /** The menu's own heading (飯類, 湯品); empty when it has none. */
    category: text().default("").notNull(),
    name: text().notNull(),
    /** Whole NT$. */
    price: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.restaurantId),
    check("bento_menu_items_price", sql`${table.price} >= 0`),
  ]
)

// What a member picks along with a dish: 甜度 and 冰量 for drinks, 飯量 or
// 不醬 for meals. Order lines copy the picked labels, so these are replaced
// wholesale when edited.
export const bentoOptionGroups = pgTable(
  "bento_option_groups",
  {
    id: uuid().defaultRandom().primaryKey(),
    restaurantId: uuid()
      .notNull()
      .references(() => bentoRestaurants.id, { onDelete: "cascade" }),
    name: text().notNull(),
    /** Every line must pick one. */
    required: boolean().default(false).notNull(),
    /** More than one may be picked (加料); otherwise at most one. */
    multiple: boolean().default(false).notNull(),
    position: integer().notNull(),
  },
  (table) => [index().on(table.restaurantId)]
)

export const bentoOptionValues = pgTable(
  "bento_option_values",
  {
    id: uuid().defaultRandom().primaryKey(),
    groupId: uuid()
      .notNull()
      .references(() => bentoOptionGroups.id, { onDelete: "cascade" }),
    label: text().notNull(),
    /** Added to the dish's price, whole NT$. */
    priceDelta: integer().default(0).notNull(),
    position: integer().notNull(),
  },
  (table) => [index().on(table.groupId)]
)

// One lunch order to one restaurant on one day; a day can have several.
export const bentoOrders = pgTable(
  "bento_orders",
  {
    id: uuid().defaultRandom().primaryKey(),
    restaurantId: uuid()
      .notNull()
      .references(() => bentoRestaurants.id, { onDelete: "restrict" }),
    date: date({ mode: "string" }).notNull(),
    status: text().default("open").notNull(),
    closedAt: timestamp({ withTimezone: true }),
    createdBy: uuid().references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index().on(table.date),
    check("bento_orders_status", sql`${table.status} in ('open', 'closed')`),
  ]
)

export type BentoLineOption = { group: string; label: string }

// One dish for one member; two of the same are two lines. The dish's name,
// picked options and price are copied when ordered, so later menu edits
// never change an order.
export const bentoOrderItems = pgTable(
  "bento_order_items",
  {
    id: uuid().defaultRandom().primaryKey(),
    orderId: uuid()
      .notNull()
      .references(() => bentoOrders.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    menuItemId: uuid().references(() => bentoMenuItems.id, {
      onDelete: "set null",
    }),
    name: text().notNull(),
    options: jsonb().$type<BentoLineOption[]>().default([]).notNull(),
    /** The dish plus its options, whole NT$. */
    price: integer().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index().on(table.orderId), index().on(table.userId)]
)
