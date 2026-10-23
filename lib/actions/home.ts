import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { homePins } from "@/lib/db/schema"
import { isServiceKey, services } from "@/lib/services"

export const listHomePins = defineAction({
  name: "list_home_pins",
  title: "置頂服務",
  description:
    "The services the signed-in member starred to the top of their portal home page, as service keys (bento, door, wiki and so on). Only their own.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const rows = await db
      .select({ service: homePins.service })
      .from(homePins)
      .where(eq(homePins.userId, actor.userId))
    const pinned = new Set(rows.map((row) => row.service))
    return {
      services: services
        .map((service) => service.key)
        .filter((key) => pinned.has(key)),
    }
  },
})

export const setHomePin = defineAction({
  name: "set_home_pin",
  title: "置頂服務",
  description:
    "Stars (pinned=true) or unstars (pinned=false) one service on the signed-in member's own portal home page; starred services show first, in a 置頂 group. Setting the state a service already has is a no-op.",
  kind: "mutation",
  input: z.object({
    service: z.string().refine(isServiceKey, "沒有這個服務"),
    pinned: z.boolean(),
  }),
  run: async (actor, { service, pinned }) => {
    if (pinned) {
      await db
        .insert(homePins)
        .values({ userId: actor.userId, service })
        .onConflictDoNothing()
    } else {
      await db
        .delete(homePins)
        .where(
          and(eq(homePins.userId, actor.userId), eq(homePins.service, service))
        )
    }
    return { service, pinned }
  },
})
