import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { assetwebConfigured, listAssets as fetchAssets } from "@/lib/assetweb"

export const listAssets = defineAction({
  name: "list_assets",
  title: "財產列表",
  description:
    "The lab's property (財產, items of NT$10,000 or more) still on the books, read live from NYCU's property system (assetweb) under the account that keeps it, the list /assets shows. Each item has id (財產編號) and no (財產分號), which together name one physical item, name, alias, brand, model, quantity, unit, cost and bookValue (NT$), acquiredOn (YYYY-MM-DD), usefulYears, keeper (保管人), user (使用人), location (存置地點, free text as the property office typed it) and note. Answers are up to 10 minutes old unless fresh is true. Every member gets the same answer; configured false means the portal has no property account set.",
  kind: "query",
  input: z.object({
    fresh: z
      .boolean()
      .default(false)
      .describe("true reads the property system again instead of the cache"),
  }),
  run: async (_actor, { fresh }) => {
    if (!assetwebConfigured()) return { configured: false, assets: [] }
    return { configured: true, assets: await fetchAssets(fresh) }
  },
})
