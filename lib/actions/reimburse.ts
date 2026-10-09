import { desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { requireAdmin } from "@/lib/actions/authz"
import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { reimburseEgress, reimburseIngress, user } from "@/lib/db/schema"

const id = z.uuid("id 格式不對")
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式是 YYYY-MM-DD")
const amount = z
  .number("金額要是數字")
  .int("金額要是整數")
  .min(0, "金額不能是負的")
  .max(100_000_000, "金額太大")

/** The member's current name for an applicant id, or an error. */
async function memberName(applicantId: string) {
  const [member] = await db
    .select({ name: user.name })
    .from(user)
    .where(eq(user.id, applicantId))
  if (!member) throw new Error("找不到這位成員")
  return member.name
}

const egressColumns = {
  id: reimburseEgress.id,
  applicantId: reimburseEgress.applicantId,
  // The member's name today, or the name recorded when they had none.
  applicant: sql<string>`coalesce(${user.name}, ${reimburseEgress.applicantName})`,
  item: reimburseEgress.item,
  amount: reimburseEgress.amount,
  invoiceDate: reimburseEgress.invoiceDate,
  transferDate: reimburseEgress.transferDate,
  transferFee: reimburseEgress.transferFee,
}

async function loadEgress() {
  return db
    .select(egressColumns)
    .from(reimburseEgress)
    .leftJoin(user, eq(user.id, reimburseEgress.applicantId))
    .orderBy(desc(reimburseEgress.invoiceDate), desc(reimburseEgress.createdAt))
}

async function loadIngress() {
  return db
    .select({
      id: reimburseIngress.id,
      date: reimburseIngress.date,
      amount: reimburseIngress.amount,
      note: reimburseIngress.note,
    })
    .from(reimburseIngress)
    .orderBy(desc(reimburseIngress.date), desc(reimburseIngress.createdAt))
}

export type LedgerEntry =
  | ({ kind: "egress"; date: string } & Awaited<
      ReturnType<typeof loadEgress>
    >[number])
  | ({ kind: "ingress" } & Awaited<ReturnType<typeof loadIngress>>[number])

export const listReimburseEntries = defineAction({
  name: "list_reimburse_entries",
  title: "帳本",
  description:
    "The lab ledger, newest first. Egress is money paid back to a member (applicant, item, amount, invoice date, transfer date or null while still owed, bank fee); ingress is money coming in (date, amount, note). Amounts are whole NT$. Every member sees every entry. Filter with kind (egress, ingress or all) and pending=true for egress not yet transferred.",
  kind: "query",
  input: z.object({
    kind: z.enum(["all", "egress", "ingress"]).default("all"),
    pending: z.boolean().default(false),
  }),
  run: async (_actor, { kind, pending }) => {
    const [egress, ingress] = await Promise.all([
      kind === "ingress" ? [] : loadEgress(),
      kind === "egress" || pending ? [] : loadIngress(),
    ])
    const entries: LedgerEntry[] = [
      ...egress
        .filter((row) => !pending || row.transferDate === null)
        .map((row) => ({
          kind: "egress" as const,
          date: row.invoiceDate,
          ...row,
        })),
      ...ingress.map((row) => ({ kind: "ingress" as const, ...row })),
    ].sort((a, b) => b.date.localeCompare(a.date))
    return { entries }
  },
})

export const getReimburseBalance = defineAction({
  name: "get_reimburse_balance",
  title: "餘額",
  description:
    "The lab fund's balance in whole NT$: money in minus money paid out (amounts plus bank fees), with totals and how much is still owed (egress with no transfer date). The owed amount is already subtracted from the balance.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [[out], [into]] = await Promise.all([
      db
        .select({
          items:
            sql<number>`coalesce(sum(${reimburseEgress.amount}), 0)`.mapWith(
              Number
            ),
          fees: sql<number>`coalesce(sum(${reimburseEgress.transferFee}), 0)`.mapWith(
            Number
          ),
          count: sql<number>`count(*)`.mapWith(Number),
          owed: sql<number>`coalesce(sum(${reimburseEgress.amount}) filter (where ${reimburseEgress.transferDate} is null), 0)`.mapWith(
            Number
          ),
          owedCount:
            sql<number>`count(*) filter (where ${reimburseEgress.transferDate} is null)`.mapWith(
              Number
            ),
        })
        .from(reimburseEgress),
      db
        .select({
          total:
            sql<number>`coalesce(sum(${reimburseIngress.amount}), 0)`.mapWith(
              Number
            ),
          count: sql<number>`count(*)`.mapWith(Number),
        })
        .from(reimburseIngress),
    ])
    const egressTotal = out.items + out.fees
    return {
      balance: into.total - egressTotal,
      ingressTotal: into.total,
      ingressCount: into.count,
      egressTotal,
      egressFees: out.fees,
      egressCount: out.count,
      owed: out.owed,
      owedCount: out.owedCount,
    }
  },
})

export const getReimburseStats = defineAction({
  name: "get_reimburse_stats",
  title: "記帳統計",
  description:
    "The ledger summed up: money in and out (amounts plus fees) per month, and per applicant how many entries, the total paid back and what is still owed. Every member sees it, as they see the ledger.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [egress, ingress] = await Promise.all([loadEgress(), loadIngress()])
    const months = new Map<string, { month: string; in: number; out: number }>()
    const month = (date: string) => {
      const key = date.slice(0, 7)
      const row = months.get(key) ?? { month: key, in: 0, out: 0 }
      months.set(key, row)
      return row
    }
    for (const row of ingress) month(row.date).in += row.amount
    const applicants = new Map<
      string,
      {
        applicantId: string | null
        name: string
        entries: number
        total: number
        owed: number
      }
    >()
    for (const row of egress) {
      month(row.invoiceDate).out += row.amount + row.transferFee
      const key = row.applicantId ?? `name:${row.applicant}`
      const applicant = applicants.get(key) ?? {
        applicantId: row.applicantId,
        name: row.applicant,
        entries: 0,
        total: 0,
        owed: 0,
      }
      applicant.entries += 1
      applicant.total += row.amount
      if (row.transferDate === null) applicant.owed += row.amount
      applicants.set(key, applicant)
    }
    return {
      months: [...months.values()].sort((a, b) =>
        a.month.localeCompare(b.month)
      ),
      applicants: [...applicants.values()].sort(
        (a, b) => b.total - a.total || a.name.localeCompare(b.name)
      ),
    }
  },
})

const egressFields = {
  applicantId: id,
  item: z.string().trim().min(1, "請填品項").max(200, "品項最多 200 字"),
  amount,
  invoiceDate: isoDate,
  transferDate: isoDate.nullable().default(null),
  transferFee: amount.default(0),
}

export const addReimburseEgress = defineAction({
  name: "add_reimburse_egress",
  title: "新增支出",
  description:
    "Records money paid back to a member (reimburse admins only): applicantId (list_members), item, amount and invoiceDate; transferDate once the money is sent (null while owed) and the bank transferFee the lab paid on top. Confirm the entry with the member first.",
  kind: "mutation",
  input: z.object(egressFields),
  run: async (actor, input) => {
    await requireAdmin(actor, "reimburse")
    const applicantName = await memberName(input.applicantId)
    const [created] = await db
      .insert(reimburseEgress)
      .values({ ...input, applicantName, recordedBy: actor.userId })
      .returning({ id: reimburseEgress.id })
    return created
  },
})

export const updateReimburseEgress = defineAction({
  name: "update_reimburse_egress",
  title: "修改支出",
  description:
    "Changes an egress entry (reimburse admins only); leave out what stays the same. Set transferDate when the money is sent, or null to mark it owed again.",
  kind: "mutation",
  input: z.object({
    entryId: id,
    applicantId: id.optional(),
    item: egressFields.item.optional(),
    amount: amount.optional(),
    invoiceDate: isoDate.optional(),
    transferDate: isoDate.nullable().optional(),
    transferFee: amount.optional(),
  }),
  run: async (actor, { entryId, applicantId, ...changes }) => {
    await requireAdmin(actor, "reimburse")
    const applicant = applicantId
      ? { applicantId, applicantName: await memberName(applicantId) }
      : {}
    const [updated] = await db
      .update(reimburseEgress)
      .set({ ...changes, ...applicant })
      .where(eq(reimburseEgress.id, entryId))
      .returning({ id: reimburseEgress.id })
    if (!updated) throw new Error("找不到這筆支出")
    return updated
  },
})

export const deleteReimburseEgress = defineAction({
  name: "delete_reimburse_egress",
  title: "刪除支出",
  description:
    "Deletes an egress entry (reimburse admins only). It cannot be undone; confirm with the member first.",
  kind: "mutation",
  input: z.object({ entryId: id }),
  run: async (actor, { entryId }) => {
    await requireAdmin(actor, "reimburse")
    const removed = await db
      .delete(reimburseEgress)
      .where(eq(reimburseEgress.id, entryId))
      .returning({ id: reimburseEgress.id })
    if (removed.length === 0) throw new Error("找不到這筆支出")
    return { entryId }
  },
})

const note = z
  .string()
  .trim()
  .max(200, "備註最多 200 字")
  .nullish()
  .transform((text) => text || null)

export const addReimburseIngress = defineAction({
  name: "add_reimburse_ingress",
  title: "新增收入",
  description:
    "Records money coming into the lab fund (reimburse admins only): date, amount in whole NT$ and an optional note.",
  kind: "mutation",
  input: z.object({ date: isoDate, amount, note }),
  run: async (actor, input) => {
    await requireAdmin(actor, "reimburse")
    const [created] = await db
      .insert(reimburseIngress)
      .values({ ...input, recordedBy: actor.userId })
      .returning({ id: reimburseIngress.id })
    return created
  },
})

export const updateReimburseIngress = defineAction({
  name: "update_reimburse_ingress",
  title: "修改收入",
  description:
    "Changes an ingress entry (reimburse admins only); leave out what stays the same, and pass an empty note to clear it.",
  kind: "mutation",
  input: z.object({
    entryId: id,
    date: isoDate.optional(),
    amount: amount.optional(),
    note: note.optional(),
  }),
  run: async (actor, { entryId, ...changes }) => {
    await requireAdmin(actor, "reimburse")
    const [updated] = await db
      .update(reimburseIngress)
      .set(changes)
      .where(eq(reimburseIngress.id, entryId))
      .returning({ id: reimburseIngress.id })
    if (!updated) throw new Error("找不到這筆收入")
    return updated
  },
})

export const deleteReimburseIngress = defineAction({
  name: "delete_reimburse_ingress",
  title: "刪除收入",
  description:
    "Deletes an ingress entry (reimburse admins only). It cannot be undone; confirm with the member first.",
  kind: "mutation",
  input: z.object({ entryId: id }),
  run: async (actor, { entryId }) => {
    await requireAdmin(actor, "reimburse")
    const removed = await db
      .delete(reimburseIngress)
      .where(eq(reimburseIngress.id, entryId))
      .returning({ id: reimburseIngress.id })
    if (removed.length === 0) throw new Error("找不到這筆收入")
    return { entryId }
  },
})
